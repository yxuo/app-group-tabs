/* extension.js
 *
 * App Group Tabs - GNOME Shell Extension
 * Sistema de abas para agrupar janelas de aplicativos
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Indicador na barra superior
const Indicator = GObject.registerClass(
    class Indicator extends PanelMenu.Button {
        _init(tabManager) {
            super._init(0.0, _('App Group Tabs'));

            this.tabManager = tabManager;

            this.add_child(new St.Icon({
                icon_name: 'view-grid-symbolic',
                style_class: 'system-status-icon',
            }));

            // Item para mostrar status dos grupos
            let statusItem = new PopupMenu.PopupMenuItem(_('Grupos Ativos'));
            statusItem.connect('activate', () => {
                const groupCount = this.tabManager.groups.size;
                const windowCount = this.tabManager.windowGroups.size;
                Main.notify(_(`App Group Tabs`),
                    _(`${groupCount} grupos ativos com ${windowCount} janelas`));
            });
            this.menu.addMenuItem(statusItem);

            // Separador
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Item para alternar modo Ctrl/Meta
            this.ctrlModeItem = new PopupMenu.PopupSwitchMenuItem(
                _('Requerer Ctrl/Meta para Agrupar'),
                this.tabManager.requireCtrl
            );
            this.ctrlModeItem.connect('toggled', (item) => {
                this.tabManager.setRequireCtrl(item.state);
            });
            this.menu.addMenuItem(this.ctrlModeItem);

            // Separador
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Item para alternar grupos automáticos
            this.startGroupsItem = new PopupMenu.PopupSwitchMenuItem(
                _('Iniciar Janelas com Grupos'),
                this.tabManager.startWithGroups
            );
            this.startGroupsItem.connect('toggled', (item) => {
                this.tabManager.setStartWithGroups(item.state);
            });
            this.menu.addMenuItem(this.startGroupsItem);

            // Separador
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Item para dissolver todos os grupos
            let dissolveAllItem = new PopupMenu.PopupMenuItem(_('Dissolver Todos os Grupos'));
            dissolveAllItem.connect('activate', () => {
                this.tabManager.dissolveAllGroups();
                Main.notify(_('App Group Tabs'), _('Todos os grupos foram dissolvidos'));
            });
            this.menu.addMenuItem(dissolveAllItem);
        }
    });

// Classe para gerenciar uma barra de abas
const TabBar = GObject.registerClass(
    class TabBar extends St.BoxLayout {
        _init(group) {
            super._init({
                style_class: 'tab-bar',
                vertical: false,
                x_expand: true,
                height: 40,
                visible: false
            });

            this.group = group;
            this.tabs = new Map();
            this._activeTab = null;

            // Container para as abas
            this._tabContainer = new St.BoxLayout({
                style_class: 'tab-container',
                vertical: false,
                x_expand: true
            });
            this.add_child(this._tabContainer);

            // Botão de fechar grupo
            const closeButton = new St.Button({
                style_class: 'tab-close-button',
                child: new St.Icon({
                    icon_name: 'window-close-symbolic',
                    icon_size: 16
                })
            });
            closeButton.connect('clicked', () => this.group.dissolve());
            this.add_child(closeButton);
        }

        addTab(window) {
            const tab = new St.Button({
                style_class: 'tab',
                x_expand: true,
                child: new St.Label({
                    text: window.get_title() || 'Janela',
                    x_align: Clutter.ActorAlign.CENTER
                })
            });

            tab.connect('clicked', () => this._activateTab(window));

            this.tabs.set(window, tab);
            this._tabContainer.add_child(tab);

            // Atualizar título quando a janela mudar
            window.connect('notify::title', () => {
                tab.child.text = window.get_title() || 'Janela';
            });

            this._updateTabStyles();
        }

        removeTab(window) {
            const tab = this.tabs.get(window);
            if (tab) {
                this._tabContainer.remove_child(tab);
                this.tabs.delete(window);
                tab.destroy();
                this._updateTabStyles();
            }
        }

        _activateTab(window) {
            this._activeTab = window;
            window.activate(global.get_current_time());
            this._updateTabStyles();
            // Sincronizar posições quando uma aba é ativada
            this.group._syncWindowPositions(window);
            // Atualizar visibilidade das janelas do grupo
            this.group._updateWindowsVisibility(window);
        }

        _updateTabStyles() {
            for (const [window, tab] of this.tabs) {
                if (window === this._activeTab) {
                    tab.add_style_class_name('active');
                } else {
                    tab.remove_style_class_name('active');
                }
            }
        }

        setActiveWindow(window) {
            this._activeTab = window;
            this._updateTabStyles();
        }

        updatePosition() {
            if (this.group.windows.length === 0) return;

            // Encontrar janelas não minimizadas
            const visibleWindows = this.group.windows.filter(window => !window.minimized);
            if (visibleWindows.length === 0) return;

            // Posicionar a barra acima da janela ativa não minimizada ou primeira janela visível
            let activeWindow = this._activeTab;
            if (!activeWindow || activeWindow.minimized) {
                activeWindow = visibleWindows[0];
            }

            const frame = activeWindow.get_frame_rect();
            const isMaximized = activeWindow.get_maximized() !== 0;
            const isTiled = this.group._isWindowTiled(activeWindow);

            if (isMaximized) {
                // Para janelas maximizadas, posicionar no topo da tela ocupando toda a largura
                const monitor = activeWindow.get_monitor();
                const workArea = global.workspace_manager.get_workspace_by_index(0).get_work_area_for_monitor(monitor);
                this.set_position(workArea.x, workArea.y);
                this.set_size(workArea.width, 40);
            } else if (isTiled) {
                // Para janelas tiled, posicionar no topo mas apenas sobre a janela específica
                const monitor = activeWindow.get_monitor();
                const workArea = global.workspace_manager.get_workspace_by_index(0).get_work_area_for_monitor(monitor);
                this.set_position(frame.x, workArea.y);
                this.set_size(frame.width, 40);
            } else {
                // Para janelas não maximizadas, posicionar acima da janela
                this.set_position(frame.x, frame.y - 40);
                this.set_size(frame.width, 40);
            }
        }
    });

// Classe para gerenciar um grupo de janelas com abas
class WindowGroup {
    constructor(manager) {
        this.manager = manager;
        this.windows = [];
        this.tabBar = new TabBar(this);
        this._signals = [];
        this._syncingPositions = false; // Flag para evitar loops de sincronização
        this._moveTimer = null; // Timer para detectar fim do movimento
        this._mouseTracker = null; // Timer para rastrear cursor no topo da tela
        this._topHoverTimeout = null; // Timeout para mostrar abas após 0.5s no topo
        this._isTabBarForcedVisible = false; // Flag para controlar visibilidade forçada

        Main.layoutManager.addTopChrome(this.tabBar);
    }

    addWindow(window) {
        if (this.windows.includes(window)) return;

        this.windows.push(window);
        this.tabBar.addTab(window);

        // Conectar sinais da janela
        const signals = [
            window.connect('position-changed', () => this._onWindowMoved(window)),
            window.connect('size-changed', () => this._onWindowResized(window)),
            window.connect('focus', () => this._onWindowFocused(window)),
            window.connect('unmanaging', () => this.removeWindow(window)),
            window.connect('notify::minimized', () => this._onWindowMinimizedChanged(window)),
            window.connect('notify::has-focus', () => this._updateTabBarVisibility()),
            window.connect('notify::maximized-horizontally', () => this._updateTabBarVisibility()),
            window.connect('notify::maximized-vertically', () => this._updateTabBarVisibility()),
            // Adicionar eventos para detectar mudanças de tiling
            window.connect('position-changed', () => this._updateTabBarVisibility()),
            window.connect('size-changed', () => this._updateTabBarVisibility())
        ];

        this._signals.push(...signals.map(id => ({ window, id })));

        this._updateTabBarVisibility();
        this.tabBar.updatePosition();

        // Sincronizar posição da nova janela com a janela ativa do grupo
        const activeWindow = this.tabBar._activeTab || this.windows[0];
        if (activeWindow && activeWindow !== window && !activeWindow.minimized) {
            this._syncWindowPositions(activeWindow);
            // Atualizar visibilidade - nova janela deve ficar oculta se não for ativa
            this._updateWindowsVisibility(activeWindow);
        }
    }

    removeWindow(window) {
        const index = this.windows.indexOf(window);
        if (index === -1) return;

        // Tornar a janela visível novamente antes de remover do grupo
        if (!window.minimized) {
            const actor = window.get_compositor_private();
            if (actor) actor.set_opacity(255); // Restaurar opacidade total
        }

        this.windows.splice(index, 1);
        this.tabBar.removeTab(window);

        // Desconectar sinais
        this._signals = this._signals.filter(signal => {
            if (signal.window === window) {
                window.disconnect(signal.id);
                return false;
            }
            return true;
        });

        this._updateTabBarVisibility();

        if (this.windows.length === 0) {
            this.dissolve();
        } else {
            this.tabBar.updatePosition();
        }
    }

    _onWindowMoved(window) {
        // Só atualizar posição se a janela não estiver minimizada
        if (!window.minimized &&
            (window === this.tabBar._activeTab ||
                (!this.tabBar._activeTab && this.windows[0] === window))) {
            this.tabBar.updatePosition();
            // Sincronizar posições das outras janelas quando a janela ativa é movida
            this._syncWindowPositions(window);

            // Configurar timer para detectar fim do movimento
            this._scheduleMovementEnd(window);
        }
    }

    _onWindowResized(window) {
        // Só atualizar posição se a janela não estiver minimizada
        if (!window.minimized &&
            (window === this.tabBar._activeTab ||
                (!this.tabBar._activeTab && this.windows[0] === window))) {
            this.tabBar.updatePosition();
            // Sincronizar posições das outras janelas quando a janela ativa é redimensionada
            this._syncWindowPositions(window);
        }
    }

    _onWindowFocused(window) {
        this.tabBar.setActiveWindow(window);
        this._updateTabBarVisibility(); // Atualizar visibilidade quando janela ganha foco
        this.tabBar.updatePosition();
        this._syncWindowPositions(window); // Sincronizar posições das janelas no grupo
        this._updateWindowsVisibility(window); // Atualizar visibilidade das janelas do grupo
    }

    _onWindowMinimizedChanged(window) {
        this._updateTabBarVisibility();
        this.tabBar.updatePosition();
    }

    _syncWindowPositions(activeWindow) {
        if (!activeWindow || activeWindow.minimized || this._syncingPositions) return;

        // Flag para evitar loops infinitos durante sincronização
        this._syncingPositions = true;

        const activeRect = activeWindow.get_frame_rect();

        // Sincronizar posição e tamanho de todas as outras janelas do grupo
        this.windows.forEach(window => {
            if (window === activeWindow || window.minimized) return;

            // Mover e redimensionar a janela para a mesma posição da ativa
            // Usar user_op = true para forçar posicionamento mesmo fora da tela
            window.move_resize_frame(
                true, // user_op = true para permitir posições fora da tela
                activeRect.x,
                activeRect.y,
                activeRect.width,
                activeRect.height
            );
        });

        // Liberar a flag após um pequeno delay
        setTimeout(() => {
            this._syncingPositions = false;
        }, 50);
    }

    _scheduleMovementEnd(window) {
        // Limpar timer anterior se existir
        if (this._moveTimer) {
            clearTimeout(this._moveTimer);
        }

        // Configurar novo timer para detectar fim do movimento
        this._moveTimer = setTimeout(() => {
            this._onMovementFinished(window);
            this._moveTimer = null;
        }, 100);
    }

    _onMovementFinished(window) {
        // Sincronizar posições mais uma vez quando o movimento terminar
        if (!window.minimized &&
            (window === this.tabBar._activeTab ||
                (!this.tabBar._activeTab && this.windows[0] === window))) {
            this._syncWindowPositions(window);
        }
    }

    _updateWindowsVisibility(activeWindow) {
        // Ajustar opacidade das janelas do grupo
        this.windows.forEach(window => {
            if (window === activeWindow) {
                // Janela ativa com opacidade total
                if (window.minimized) return; // Não alterar se estiver minimizada
                const actor = window.get_compositor_private();
                if (actor) actor.set_opacity(255); // 100% opacidade
            } else {
                // Outras janelas com opacidade reduzida
                if (window.minimized) return; // Não alterar se estiver minimizada
                const actor = window.get_compositor_private();
                if (actor) actor.set_opacity(0); // 20% opacidade (255 * 0.2 ≈ 51)
            }
        });
    }

    _updateTabBarVisibility() {
        if (this.windows.length === 0) {
            this.tabBar.visible = false;
            this._stopMouseTracking();
            return;
        }

        // Verificar se há pelo menos uma janela não minimizada no grupo
        const hasVisibleWindow = this.windows.some(window => !window.minimized);
        if (!hasVisibleWindow) {
            this.tabBar.visible = false;
            this._stopMouseTracking();
            return;
        }

        const hasWindowInFocus = this.windows.some(window => window.has_focus());
        const hasWindowMaximized = this.windows.some(window => window.get_maximized() !== 0);
        const hasWindowTiled = this.windows.some(window => this._isWindowTiled(window));

        if (hasWindowInFocus) {
            if (hasWindowMaximized || hasWindowTiled) {
                // Para janelas maximizadas ou tiled, sempre usar detecção de cursor no topo
                if (this._isTabBarForcedVisible) {
                    this.tabBar.visible = true;
                } else {
                    this.tabBar.visible = false;
                    this._startMouseTracking();
                }
            } else {
                // Para janelas não maximizadas nem tiled, mostrar normalmente
                this.tabBar.visible = true;
                this._stopMouseTracking();
            }
        } else if (hasWindowTiled) {
            // Para janelas tiled sem foco, ainda permitir detecção de hover
            // já que cada janela tem sua própria área de hover
            if (this._isTabBarForcedVisible) {
                this.tabBar.visible = true;
            } else {
                this.tabBar.visible = false;
                this._startMouseTracking();
            }
        } else {
            this.tabBar.visible = false;
            this._stopMouseTracking();
        }
    }

    _isWindowTiled(window) {
        if (window.minimized || window.get_maximized() !== 0) {
            return false; // Janelas minimizadas ou maximizadas não são consideradas tiled
        }

        const windowRect = window.get_frame_rect();
        const monitor = window.get_monitor();
        const workArea = global.workspace_manager.get_workspace_by_index(0).get_work_area_for_monitor(monitor);

        // Verificar se a janela ocupa exatamente metade horizontal da tela
        // Tolerância de alguns pixels para bordas e gaps
        const tolerance = 10;

        // Verificar altura: deve ocupar toda ou quase toda a altura disponível
        const heightMatch = Math.abs(windowRect.height - workArea.height) <= tolerance;

        // Verificar largura: deve ocupar aproximadamente metade da largura
        const expectedHalfWidth = workArea.width / 2;
        const widthMatch = Math.abs(windowRect.width - expectedHalfWidth) <= tolerance;

        // Verificar posição vertical: deve estar alinhada com o topo da work area
        const topMatch = Math.abs(windowRect.y - workArea.y) <= tolerance;

        // Verificar posição horizontal: deve estar no lado esquerdo ou direito
        const leftSideMatch = Math.abs(windowRect.x - workArea.x) <= tolerance;
        const rightSideMatch = Math.abs(windowRect.x - (workArea.x + expectedHalfWidth)) <= tolerance;

        return heightMatch && widthMatch && topMatch && (leftSideMatch || rightSideMatch);
    }

    _startMouseTracking() {
        if (this._mouseTracker) return; // Já está rastreando

        this._mouseTracker = setInterval(() => {
            const [x, y] = global.get_pointer();
            const monitor = global.display.get_current_monitor();
            const workArea = global.workspace_manager.get_workspace_by_index(0).get_work_area_for_monitor(monitor);

            // Encontrar a janela ativa ou primeira visível
            let activeWindow = this.tabBar._activeTab;
            if (!activeWindow || activeWindow.minimized) {
                const visibleWindows = this.windows.filter(window => !window.minimized);
                if (visibleWindows.length === 0) return;
                activeWindow = visibleWindows[0];
            }

            const isMaximized = activeWindow.get_maximized() !== 0;
            const isTiled = this._isWindowTiled(activeWindow);

            let isInTargetArea = false;

            if (isMaximized) {
                // Para janelas maximizadas, verificar se está no topo da tela (primeiros 5 pixels)
                // OU na área da barra de abas (quando ela estiver visível)
                const isInTopArea = y <= workArea.y + 5;
                const isInTabBarArea = this._isTabBarForcedVisible &&
                    y >= workArea.y &&
                    y <= workArea.y + 40 &&
                    x >= workArea.x &&
                    x <= workArea.x + workArea.width;
                isInTargetArea = isInTopArea || isInTabBarArea;
            } else if (isTiled) {
                // Para janelas tiled, verificar se está no topo E na área horizontal da janela específica
                const frame = activeWindow.get_frame_rect();
                const isInTopArea = y <= workArea.y + 5;
                const isInWindowHorizontalArea = x >= frame.x && x <= frame.x + frame.width;
                const isInTabBarArea = this._isTabBarForcedVisible &&
                    y >= workArea.y &&
                    y <= workArea.y + 40 &&
                    x >= frame.x &&
                    x <= frame.x + frame.width;
                isInTargetArea = (isInTopArea && isInWindowHorizontalArea) || isInTabBarArea;
            } if (isInTargetArea) {
                if (!this._topHoverTimeout && !this._isTabBarForcedVisible) {
                    // Verificar se estamos no modo de visualização de abas tiled
                    const isTiledModeActive = this.manager._isTiledTabModeActive();

                    if (isTiledModeActive && isTiled) {
                        // Se o modo tiled já está ativo e esta é uma janela tiled, mostrar imediatamente
                        this._showTabBarTemporarily();
                    } else {
                        // Primeira vez ou janela maximizada, usar timeout normal
                        this._topHoverTimeout = setTimeout(() => {
                            this._showTabBarTemporarily();
                        }, 200); // 0.2 segundos
                    }
                }
            } else {
                // Cursor saiu da área alvo, cancelar timeout e esconder barra
                if (this._topHoverTimeout) {
                    clearTimeout(this._topHoverTimeout);
                    this._topHoverTimeout = null;
                }
                if (this._isTabBarForcedVisible) {
                    this._hideTabBarTemporarily();
                }
            }
        }, 50); // Verificar a cada 50ms
    }

    _stopMouseTracking() {
        if (this._mouseTracker) {
            clearInterval(this._mouseTracker);
            this._mouseTracker = null;
        }

        if (this._topHoverTimeout) {
            clearTimeout(this._topHoverTimeout);
            this._topHoverTimeout = null;
        }

        if (this._isTabBarForcedVisible) {
            this._hideTabBarTemporarily();
        }
    }

    _showTabBarTemporarily() {
        this._isTabBarForcedVisible = true;
        this.tabBar.visible = true;
        this.tabBar.updatePosition();

        // Ativar modo tiled se for uma janela tiled
        const activeWindow = this.tabBar._activeTab || this.windows.find(w => !w.minimized);
        if (activeWindow && this._isWindowTiled(activeWindow)) {
            this.manager._activateTiledTabMode();
        }

        // Limpar timeout de criação, já que a barra agora está visível
        if (this._topHoverTimeout) {
            clearTimeout(this._topHoverTimeout);
            this._topHoverTimeout = null;
        }
    }

    _hideTabBarTemporarily() {
        this._isTabBarForcedVisible = false;
        this.tabBar.visible = false;

        // Agendar desativação do modo tiled se esta era uma janela tiled
        const activeWindow = this.tabBar._activeTab || this.windows.find(w => !w.minimized);
        if (activeWindow && this._isWindowTiled(activeWindow)) {
            this.manager._scheduleDeactivateTiledTabMode();
        }

        if (this._topHoverTimeout) {
            clearTimeout(this._topHoverTimeout);
            this._topHoverTimeout = null;
        }
    }

    dissolve() {
        // Limpar timer de movimento se existir
        if (this._moveTimer) {
            clearTimeout(this._moveTimer);
            this._moveTimer = null;
        }

        // Parar rastreamento do mouse e limpar timers
        this._stopMouseTracking();

        // Tornar todas as janelas visíveis novamente antes de dissolver o grupo
        this.windows.forEach(window => {
            if (!window.minimized) {
                const actor = window.get_compositor_private();
                if (actor) actor.set_opacity(255); // Restaurar opacidade total
            }
        });

        // Desconectar todos os sinais
        this._signals.forEach(signal => {
            signal.window.disconnect(signal.id);
        });
        this._signals = [];

        // Remover cada janela do grupo
        this.windows.forEach(window => {
            this.manager.windowGroups.delete(window);
        });

        // Destruir a barra de abas
        Main.layoutManager.removeChrome(this.tabBar);
        this.tabBar.destroy();

        // Remover do gerenciador
        this.manager.groups.delete(this);
    }
}

// Classe principal para gerenciar o sistema de abas
class TabManager {
    constructor(extension) {
        this.extension = extension;
        this.groups = new Set();
        this.windowGroups = new Map(); // window -> group
        this._signals = [];
        this._dropIndicator = null;
        this._draggedWindow = null;
        this._isCtrlPressed = false; // Estado atual do Ctrl/Meta
        this._tiledTabModeActive = false; // Flag global para modo de visualização de abas tiled

        // Carregar configurações
        this._settings = extension.getSettings();
        this.requireCtrl = this._settings.get_boolean('require-ctrl');
        this.startWithGroups = this._settings.get_boolean('start-with-groups');

        // Conectar mudanças de configuração
        this._settingsId = this._settings.connect('changed::require-ctrl', () => {
            this.requireCtrl = this._settings.get_boolean('require-ctrl');
        });
        this._startGroupsSettingsId = this._settings.connect('changed::start-with-groups', () => {
            this.startWithGroups = this._settings.get_boolean('start-with-groups');
        });
    }

    enable() {
        // Conectar sinais globais
        this._signals.push(
            global.display.connect('window-created', (display, window) => {
                this._onWindowCreated(window);
            })
        );

        // Detectar operações de grab globalmente
        this._signals.push(
            global.display.connect('grab-op-begin', (display, window, op) => {
                if (op === Meta.GrabOp.MOVING) {
                    this._draggedWindow = window;
                }
            })
        );

        this._signals.push(
            global.display.connect('grab-op-end', (display, window, op) => {
                if (op === Meta.GrabOp.MOVING && this._draggedWindow === window) {
                    this._onWindowDropped(window);
                    this._draggedWindow = null;
                }
            })
        );

        // Monitorar mudanças globais de foco para atualizar visibilidade
        this._signals.push(
            global.display.connect('notify::focus-window', () => {
                this._onGlobalFocusChanged();
            })
        );

        // Conectar eventos de teclado para detectar Ctrl e Meta
        this._keyPressId = global.stage.connect('key-press-event', (actor, event) => {
            const keySymbol = event.get_key_symbol();
            if (keySymbol === Clutter.KEY_Control_L ||
                keySymbol === Clutter.KEY_Control_R ||
                keySymbol === Clutter.KEY_Meta_L ||
                keySymbol === Clutter.KEY_Meta_R ||
                keySymbol === Clutter.KEY_Super_L ||
                keySymbol === Clutter.KEY_Super_R) {
                this._isCtrlPressed = true;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._keyReleaseId = global.stage.connect('key-release-event', (actor, event) => {
            const keySymbol = event.get_key_symbol();
            if (keySymbol === Clutter.KEY_Control_L ||
                keySymbol === Clutter.KEY_Control_R ||
                keySymbol === Clutter.KEY_Meta_L ||
                keySymbol === Clutter.KEY_Meta_R ||
                keySymbol === Clutter.KEY_Super_L ||
                keySymbol === Clutter.KEY_Super_R) {
                this._isCtrlPressed = false;
                this._hideDropIndicator();
            }
            return Clutter.EVENT_PROPAGATE;
        });

        // Processar janelas existentes e criar grupos individuais se configurado
        if (this.startWithGroups) {
            global.get_window_actors().forEach(actor => {
                const window = actor.get_meta_window();
                if (window && window.window_type === Meta.WindowType.NORMAL) {
                    this._onWindowCreated(window);
                    this._createIndividualGroup(window);
                }
            });
        } else {
            // Apenas conectar eventos, sem criar grupos
            global.get_window_actors().forEach(actor => {
                const window = actor.get_meta_window();
                if (window && window.window_type === Meta.WindowType.NORMAL) {
                    this._onWindowCreated(window);
                }
            });
        }

        this._createDropIndicator();

        // Método alternativo: usar um timer para verificar estado das teclas
        this._checkModifierTimer = setInterval(() => {
            const [x, y, mask] = global.get_pointer();
            const hasCtrlMod = (mask & Clutter.ModifierType.CONTROL_MASK) !== 0;
            const hasMetaMod = (mask & Clutter.ModifierType.META_MASK) !== 0;
            const hasSuperMod = (mask & Clutter.ModifierType.SUPER_MASK) !== 0;

            // Considerar pressionado se qualquer um dos modificadores estiver ativo
            const hasModifier = hasCtrlMod || hasMetaMod || hasSuperMod;

            if (hasModifier !== this._isCtrlPressed) {
                this._isCtrlPressed = hasModifier;
            }
        }, 100); // Verificar a cada 100ms
    }

    disable() {
        // Dissolver todos os grupos
        Array.from(this.groups).forEach(group => group.dissolve());

        // Desconectar sinais
        this._signals.forEach(id => global.display.disconnect(id));
        this._signals = [];

        // Desconectar eventos de teclado
        if (this._keyPressId) {
            global.stage.disconnect(this._keyPressId);
            this._keyPressId = null;
        }

        if (this._keyReleaseId) {
            global.stage.disconnect(this._keyReleaseId);
            this._keyReleaseId = null;
        }

        // Limpar timer de verificação de modificadores
        if (this._checkModifierTimer) {
            clearInterval(this._checkModifierTimer);
            this._checkModifierTimer = null;
        }

        // Limpar timeout do modo tiled
        if (this._tiledTabModeTimeout) {
            clearTimeout(this._tiledTabModeTimeout);
            this._tiledTabModeTimeout = null;
        }

        // Desconectar configurações
        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = null;
        }

        if (this._startGroupsSettingsId) {
            this._settings.disconnect(this._startGroupsSettingsId);
            this._startGroupsSettingsId = null;
        }

        this._destroyDropIndicator();
    }

    _onGlobalFocusChanged() {
        // Atualizar visibilidade de todos os grupos quando o foco muda globalmente
        this.groups.forEach(group => {
            group._updateTabBarVisibility();
        });
    }

    _onWindowCreated(window) {
        if (window.window_type !== Meta.WindowType.NORMAL) return;

        // Criar grupo individual apenas se a configuração estiver habilitada
        if (this.startWithGroups) {
            this._createIndividualGroup(window);
        }

        // Conectar evento de movimento para atualizar indicador
        window.connect('position-changed', () => this._onWindowMoved(window));
    }

    _onWindowMoved(window) {
        if (this._draggedWindow !== window) return;

        const shouldShowIndicator = !this.requireCtrl || this._isCtrlPressed;
        if (shouldShowIndicator) {
            const targetWindow = this._getWindowUnder(window);
            if (targetWindow && targetWindow !== window &&
                !this._areInSameGroup(window, targetWindow)) {
                this._showDropIndicator(targetWindow);
            } else {
                this._hideDropIndicator();
            }
        } else {
            this._hideDropIndicator();
        }
    }

    _onWindowDropped(window) {
        // Verificar se precisa do Ctrl/Meta e se está pressionado
        const shouldGroup = !this.requireCtrl || this._isCtrlPressed;

        if (shouldGroup) {
            const targetWindow = this._getWindowUnder(window);
            if (targetWindow && targetWindow !== window &&
                !this._areInSameGroup(window, targetWindow)) {
                this._groupWindows(window, targetWindow);
            }
        }

        this._hideDropIndicator();
    }

    _getWindowUnder(draggedWindow) {
        const draggedRect = draggedWindow.get_frame_rect();
        const draggedCenter = {
            x: draggedRect.x + draggedRect.width / 2,
            y: draggedRect.y + draggedRect.height / 2
        };

        const windows = global.get_window_actors()
            .map(actor => actor.get_meta_window())
            .filter(window =>
                window &&
                window !== draggedWindow &&
                window.window_type === Meta.WindowType.NORMAL &&
                window.showing_on_its_workspace()
            );

        for (const window of windows) {
            const rect = window.get_frame_rect();
            if (draggedCenter.x >= rect.x && draggedCenter.x <= rect.x + rect.width &&
                draggedCenter.y >= rect.y && draggedCenter.y <= rect.y + rect.height) {
                return window;
            }
        }

        return null;
    }

    _areInSameGroup(window1, window2) {
        const group1 = this.windowGroups.get(window1);
        const group2 = this.windowGroups.get(window2);
        return group1 && group2 && group1 === group2;
    }

    _groupWindows(window1, window2) {
        const group1 = this.windowGroups.get(window1);
        const group2 = this.windowGroups.get(window2);

        if (group1 && group2) {
            // Mesclar grupos existentes
            this._mergeGroups(group1, group2);
        } else if (group1) {
            // Adicionar window2 ao grupo de window1
            group1.addWindow(window2);
            this.windowGroups.set(window2, group1);
        } else if (group2) {
            // Adicionar window1 ao grupo de window2
            group2.addWindow(window1);
            this.windowGroups.set(window1, group2);
        } else {
            // Criar novo grupo
            const newGroup = new WindowGroup(this);
            this.groups.add(newGroup);

            newGroup.addWindow(window2);
            newGroup.addWindow(window1);

            this.windowGroups.set(window1, newGroup);
            this.windowGroups.set(window2, newGroup);
        }
    }

    _mergeGroups(group1, group2) {
        // Mover todas as janelas do group2 para o group1
        const windowsToMove = [...group2.windows];
        windowsToMove.forEach(window => {
            group2.removeWindow(window);
            group1.addWindow(window);
            this.windowGroups.set(window, group1);
        });
    }

    _createDropIndicator() {
        this._dropIndicator = new St.Widget({
            style_class: 'drop-indicator',
            visible: false
        });
        Main.layoutManager.addTopChrome(this._dropIndicator);
    }

    _destroyDropIndicator() {
        if (this._dropIndicator) {
            Main.layoutManager.removeChrome(this._dropIndicator);
            this._dropIndicator.destroy();
            this._dropIndicator = null;
        }
    }

    _showDropIndicator(targetWindow) {
        if (!this._dropIndicator) return;

        const rect = targetWindow.get_frame_rect();
        this._dropIndicator.set_position(rect.x - 5, rect.y - 5);
        this._dropIndicator.set_size(rect.width + 10, rect.height + 10);
        this._dropIndicator.visible = true;
    }

    _hideDropIndicator() {
        if (this._dropIndicator) {
            this._dropIndicator.visible = false;
        }
    }

    _createIndividualGroup(window) {
        // Só criar grupo se a janela ainda não estiver em um grupo
        if (this.windowGroups.has(window)) return;

        const newGroup = new WindowGroup(this);
        this.groups.add(newGroup);

        newGroup.addWindow(window);
        this.windowGroups.set(window, newGroup);
    }

    dissolveAllGroups() {
        // Criar uma cópia do Set para evitar modificação durante iteração
        const groupsToDissolve = Array.from(this.groups);
        groupsToDissolve.forEach(group => {
            group.dissolve();
        });
    }

    setRequireCtrl(value) {
        this.requireCtrl = value;
        this._settings.set_boolean('require-ctrl', value);

        if (this.requireCtrl && !this._isCtrlPressed) {
            this._hideDropIndicator();
        }
    }

    setStartWithGroups(value) {
        this.startWithGroups = value;
        // Salvar nas configurações
        this._settings.set_boolean('start-with-groups', value);

        // Se habilitou grupos automáticos, criar grupos para janelas sem grupo
        if (this.startWithGroups) {
            global.get_window_actors().forEach(actor => {
                const window = actor.get_meta_window();
                if (window &&
                    window.window_type === Meta.WindowType.NORMAL &&
                    !this.windowGroups.has(window)) {
                    this._createIndividualGroup(window);
                }
            });
        }
        // Se desabilitou, não remove grupos existentes - apenas afeta novas janelas
    }

    // Métodos para gerenciar o modo de visualização de abas tiled
    _activateTiledTabMode() {
        this._tiledTabModeActive = true;
        // Limpar qualquer timeout existente para desativar o modo
        if (this._tiledTabModeTimeout) {
            clearTimeout(this._tiledTabModeTimeout);
            this._tiledTabModeTimeout = null;
        }
    }

    _scheduleDeactivateTiledTabMode() {
        // Agendar desativação do modo apenas se não houver barras tiled visíveis
        if (this._tiledTabModeTimeout) {
            clearTimeout(this._tiledTabModeTimeout);
        }

        this._tiledTabModeTimeout = setTimeout(() => {
            // Verificar se ainda há alguma barra tiled visível antes de desativar
            const hasAnyTiledVisible = Array.from(this.groups).some(group => {
                const hasTiledWindow = group.windows.some(window => group._isWindowTiled(window));
                return hasTiledWindow && group._isTabBarForcedVisible;
            });

            if (!hasAnyTiledVisible) {
                this._tiledTabModeActive = false;
            }
            this._tiledTabModeTimeout = null;
        }, 100); // Pequeno delay para verificar estado
    }

    _isTiledTabModeActive() {
        return this._tiledTabModeActive;
    }
}

export default class AppGroupTabsExtension extends Extension {
    enable() {
        this._tabManager = new TabManager(this);
        this._tabManager.enable();

        // Adicionar indicador na barra superior
        this._indicator = new Indicator(this._tabManager);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        if (this._tabManager) {
            this._tabManager.disable();
            this._tabManager = null;
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
