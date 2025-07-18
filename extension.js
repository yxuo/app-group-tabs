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
import Gio from 'gi://Gio';

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
                _('Grupos com uma Janela'),
                this.tabManager.singleWindowGroups
            );
            this.startGroupsItem.connect('toggled', (item) => {
                this.tabManager.setSingleWindowGroups(item.state);
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
            this._activeContextMenu = null; // Rastrear menu de contexto ativo

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
            // Container principal da aba
            const tab = new St.Button({
                style_class: 'tab',
                x_expand: true
            });

            // Container interno para organizar label e botão de fechar
            const tabContent = new St.BoxLayout({
                vertical: false,
                x_expand: true,
                x_align: Clutter.ActorAlign.FILL
            });

            // Label com o título da janela
            const tabLabel = new St.Label({
                text: window.get_title() || 'Janela',
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true
            });

            // Botão de fechar a aba (remover do grupo)
            const closeTabButton = new St.Button({
                style_class: 'tab-close-button-small',
                child: new St.Icon({
                    icon_name: 'window-close-symbolic',
                    icon_size: 12
                }),
                reactive: true,
                can_focus: true,
                track_hover: true
            });

            // Conectar evento do botão de fechar
            closeTabButton.connect('clicked', (button, event) => {
                console.log(`[Tab Close] Fechando aba "${window.get_title()}"`);

                // Verificar se o grupo tem mais de uma janela
                if (this.group.windows.length <= 1) {
                    Main.notify(_('App Group Tabs'), _('Não é possível fechar a única aba do grupo'));
                    return Clutter.EVENT_STOP;
                }

                // Separar a janela do grupo
                this._separateWindowFromGroup(window);
                return Clutter.EVENT_STOP;
            });

            // Adicionar hover effect no botão de fechar
            closeTabButton.connect('enter-event', () => {
                closeTabButton.add_style_class_name('hover');
            });

            closeTabButton.connect('leave-event', () => {
                closeTabButton.remove_style_class_name('hover');
            });

            // Montar a estrutura da aba
            tabContent.add_child(tabLabel);
            tabContent.add_child(closeTabButton);
            tab.set_child(tabContent);

            // Armazenar referências para facilitar acesso
            tab.tabLabel = tabLabel;
            tab.closeButton = closeTabButton;

            // Estados possíveis: 'none', 'down', 'drag', 'up', 'click'
            let tabState = 'none';
            let pressStartX = 0;
            let pressStartY = 0;
            let dragMotionId = null;
            let dragReleaseId = null;
            let lastReorderedWindow = null; // Rastrear última aba reordenada para evitar loops
            let dragClone = null; // Clone visual da aba durante o drag
            let dragOffsetX = 0; // Offset do cursor em relação à aba
            let dragOffsetY = 0;
            let lastReorderTime = 0; // Timestamp da última reordenação
            let lastCursorX = 0; // Última posição X do cursor para detectar direção
            const dragThreshold = 5; // pixels
            const reorderCooldown = 150; // milliseconds entre reordenações

            // Função para criar clone visual da aba
            const createDragClone = (cursorX, cursorY) => {
                if (dragClone) return; // Clone já existe

                // Obter posição e dimensões da aba original
                const [tabX, tabY] = tab.get_transformed_position();
                const originalWidth = tab.get_width();
                const originalHeight = tab.get_height();
                
                // Calcular offset do cursor em relação à posição da aba
                dragOffsetX = cursorX - tabX;
                dragOffsetY = cursorY - tabY;

                // Buffer invisível para garantir captura do cursor
                const buffer = 800;

                // Criar clone visual com buffer expandido (para captura de eventos)
                dragClone = new St.Button({
                    style_class: 'tab tab-dragging',
                    width: originalWidth + (buffer * 2),
                    height: originalHeight + (buffer * 2),
                    child: new St.Label({
                        text: window.get_title() || 'Janela',
                        x_align: Clutter.ActorAlign.CENTER
                    })
                });

                // Aplicar estilo - buffer transparente para captura de eventos
                dragClone.style = `
                    padding: 0px;
                    background: transparent;
                    border: none;
                    box-shadow: 0 0 10px rgba(0, 0, 0, 0);
                `;

                // Criar clone visual da aba (aparência normal da aba por cima)
                const visualClone = new St.Button({
                    style_class: 'tab tab-dragging',
                    width: originalWidth,
                    height: originalHeight,
                    child: new St.Label({
                        text: window.get_title() || 'Janela',
                        x_align: Clutter.ActorAlign.CENTER
                    })
                });

                // Posicionar o clone visual centralizado sobre o buffer
                visualClone.set_position(buffer, buffer);
                dragClone.add_child(visualClone);

                // Adicionar o clone ao layoutManager para ficar sobre tudo
                Main.layoutManager.addTopChrome(dragClone);

                // Posicionar o clone para que o visual fique exatamente na posição da aba original
                const cloneX = tabX - buffer - 2;
                const cloneY = tabY - buffer - 4;
                dragClone.set_position(cloneX, cloneY);

                // Registrar o clone no GlobalShellManager se disponível
                if (this.group.manager.extension._globalShellManager) {
                    this.group.manager.extension._globalShellManager.registerDragClone(dragClone);
                } else {
                    console.warn(`[Drag Clone] GlobalShellManager não disponível, clone não registrado`);
                }

                console.log(`[Drag Clone] Clone criado para aba "${window.get_title()}" em (${cloneX}, ${cloneY}) - aba original em (${tabX}, ${tabY})`);
            };

            // Função para atualizar posição do clone
            const updateDragClone = (cursorX, cursorY) => {
                if (!dragClone) return;

                // Buffer invisível
                const buffer = 800;

                // Atualizar posição do clone mantendo o buffer
                const cloneX = cursorX - dragOffsetX - buffer - 2;
                const cloneY = cursorY - dragOffsetY - buffer - 4;

                dragClone.set_position(cloneX, cloneY);

                // console.log(`[Clone Update] Clone reposicionado para (${cloneX}, ${cloneY}) seguindo cursor em (${cursorX}, ${cursorY})`);
            };

            // Função para destruir clone visual
            const destroyDragClone = () => {
                if (dragClone) {
                    // Desregistrar o clone do GlobalShellManager se disponível
                    if (this.group.manager.extension._globalShellManager) {
                        this.group.manager.extension._globalShellManager.unregisterDragClone(dragClone);
                    }

                    Main.layoutManager.removeChrome(dragClone);
                    try {
                        dragClone.destroy();
                    } catch (e) { }
                    dragClone = null;
                    console.log(`[Drag Clone] Clone destruído para aba "${window.get_title()}"`);
                }
            };

            // Função para atualizar estado
            const updateState = (newState, event) => {
                const oldState = tabState;
                tabState = newState;
                const [x, y] = event ? event.get_coords() : [0, 0];

                // Resetar lastReorderedWindow quando sair do estado de drag
                if (oldState === 'drag' && newState !== 'drag') {
                    lastReorderedWindow = null;
                    // Destruir clone quando sair do drag
                    destroyDragClone();
                    // Tornar aba original visível novamente
                    tab.set_opacity(255);
                    // Esconder indicador de drop ao sair do drag
                    this.group.manager._hideDropIndicator();
                }

                // Criar clone quando entrar em drag
                if (oldState !== 'drag' && newState === 'drag') {
                    createDragClone(x, y);
                    // Tornar aba original semi-transparente
                    tab.set_opacity(0);
                }

                console.log(`[State Change] Aba "${window.get_title()}": ${oldState} -> ${newState}`);
            };

            // Função para encontrar a aba sob o cursor
            const getTabUnderCursor = (x, y) => {
                for (const [targetWindow, targetTab] of this.tabs) {
                    if (targetTab === tab) continue; // Ignorar a própria aba

                    const [tabX, tabY] = targetTab.get_transformed_position();
                    const tabWidth = targetTab.get_width();
                    const tabHeight = targetTab.get_height();

                    // Verificar se está sobre a aba
                    if (x >= tabX && x <= tabX + tabWidth && y >= tabY && y <= tabY + tabHeight) {
                        // Calcular se passou da metade da aba
                        const tabCenterX = tabX + tabWidth / 2;
                        const passedHalf = x > tabCenterX;

                        return {
                            window: targetWindow,
                            tab: targetTab,
                            passedHalf: passedHalf
                        };
                    }
                }
                return null;
            };

            // Função para reordenar abas
            const reorderTab = (draggedWindow, targetWindow) => {
                const children = this._tabContainer.get_children();
                const draggedTab = this.tabs.get(draggedWindow);
                const targetTab = this.tabs.get(targetWindow);

                if (!draggedTab || !targetTab) return;

                // Remover a aba arrastada do container
                this._tabContainer.remove_child(draggedTab);

                // Encontrar a posição da aba alvo
                const targetIndex = children.indexOf(targetTab);

                // Inserir a aba arrastada na nova posição
                this._tabContainer.insert_child_at_index(draggedTab, targetIndex);

                console.log(`[Reorder] Aba "${draggedWindow.get_title()}" movida para posição da aba "${targetWindow.get_title()}"`);
            };

            // Conectar eventos de mouse down
            tab.connect('button-press-event', (actor, event) => {
                if (event.get_button() === 1) { // Botão esquerdo do mouse
                    const [x, y] = event.get_coords();
                    pressStartX = x;
                    pressStartY = y;

                    updateState('down', event);

                    // Conectar eventos globais para detectar movimento
                    dragMotionId = global.stage.connect('motion-event', (stage, motionEvent) => {
                        // Log de comparação de estados: Aba vs GSM
                        const gsmState = this.group.manager.extension._globalShellManager?._lastButtonState?.event || 'none';
                        console.log(`[State Compare] Aba: "${tabState}" | GSM: "${gsmState}" | Window: "${window.get_title()}"`);

                        if (tabState === 'down') {
                            const [currentX, currentY] = motionEvent.get_coords();
                            const deltaX = Math.abs(currentX - pressStartX);
                            const deltaY = Math.abs(currentY - pressStartY);

                            // Verificar se moveu mais que o threshold
                            if (deltaX > dragThreshold || deltaY > dragThreshold) {
                                updateState('drag', motionEvent);
                                // Resetar controle de reordenação ao iniciar novo drag
                                lastReorderedWindow = null;
                                // Adicionar classe visual para indicar drag
                                tab.add_style_class_name('dragging');
                            }
                        } else if (tabState === 'drag') {
                            // Durante o drag, atualizar posição do clone
                            const [currentX, currentY] = motionEvent.get_coords();
                            updateDragClone(currentX, currentY);

                            // Verificar se o state global não é 'drag'
                            const gsm = this.group.manager.extension._globalShellManager;
                            const gsmState = gsm?._lastButtonState?.event || 'none';
                            if (gsmState !== 'drag') {
                                gsm.destroyAllDragClones();
                                updateState('up', releaseEvent);
                                tab._updateTabStyles();
                            }

                            // Verificar se está sobre a barra de abas para reordenação ou fora para agrupamento
                            const [tabBarX, tabBarY] = this.get_transformed_position();
                            const tabBarWidth = this.get_width();
                            const tabBarHeight = this.get_height();

                            const isOverTabBar = currentX >= tabBarX && currentX <= tabBarX + tabBarWidth &&
                                currentY >= tabBarY && currentY <= tabBarY + tabBarHeight;

                            if (isOverTabBar) {
                                // Lógica de reordenação dentro da barra (código existente)
                                const tabUnder = getTabUnderCursor(currentX, currentY);
                                const currentTime = Date.now();

                                if (tabUnder && tabUnder.window !== window && tabUnder.passedHalf) {
                                    // Lógica melhorada de reordenação com cooldown e detecção de direção
                                    const timeSinceLastReorder = currentTime - lastReorderTime;
                                    const cursorMovingRight = currentX > lastCursorX;
                                    const cursorMovingLeft = currentX < lastCursorX;

                                    // Permitir reordenação se:
                                    // 1. É uma aba diferente da última reordenada OU
                                    // 2. Passou o tempo de cooldown E mudou de direção
                                    const isDifferentTab = lastReorderedWindow !== tabUnder.window;
                                    const hasCooldownPassed = timeSinceLastReorder > reorderCooldown;

                                    if (isDifferentTab || hasCooldownPassed) {
                                        console.log(`[Reorder Decision] Movendo "${window.get_title()}" para posição de "${tabUnder.window.get_title()}" (diferente: ${isDifferentTab}, cooldown: ${hasCooldownPassed})`);
                                        reorderTab(window, tabUnder.window);
                                        lastReorderedWindow = tabUnder.window;
                                        lastReorderTime = currentTime;
                                    } else {
                                        console.log(`[Reorder Skip] Aguardando cooldown para "${tabUnder.window.get_title()}" (${reorderCooldown - timeSinceLastReorder}ms restantes)`);
                                    }
                                } else {
                                    // Se não está sobre nenhuma aba válida, permitir reset mais rápido
                                    if (lastReorderedWindow && !tabUnder) {
                                        const timeSinceLastReorder = currentTime - lastReorderTime;
                                        if (timeSinceLastReorder > reorderCooldown / 2) {
                                            console.log(`[Reorder Reset] Cursor fora das abas, resetando controle de reordenação`);
                                            lastReorderedWindow = null;
                                        }
                                    }
                                    // Esconder indicador quando dentro da barra mas não sobre abas
                                    this.group.manager._hideDropIndicator();
                                }
                            } else {
                                // Fora da barra de abas - detectar janela alvo para agrupamento
                                const targetWindow = this.group.manager._getWindowUnder(window);
                                if (targetWindow) {
                                    // Mostrar indicador de drop na janela alvo
                                    this.group.manager._showDropIndicator(targetWindow);
                                    console.log(`[Tab Drag External] Aba "${window.get_title()}" sobre janela "${targetWindow.get_title()}"`);
                                } else {
                                    // Esconder indicador se não há janela alvo
                                    this.group.manager._hideDropIndicator();
                                    console.log(`[Tab Drag External] Aba "${window.get_title()}" em área vazia`);
                                }

                                // Resetar controle de reordenação quando fora da barra
                                lastReorderedWindow = null;
                            }

                            // Atualizar posição do cursor para detecção de direção
                            lastCursorX = currentX;

                            // console.log(`[Drag Movement] Aba "${window.get_title()}" movendo para (${currentX}, ${currentY})`);
                        }
                        return Clutter.EVENT_PROPAGATE;
                    });

                    // Conectar evento global de mouse up
                    dragReleaseId = global.stage.connect('button-release-event', (stage, releaseEvent) => {
                        if (releaseEvent.get_button() === 1) {
                            // Limpar event listeners primeiro
                            if (dragMotionId) {
                                global.stage.disconnect(dragMotionId);
                                dragMotionId = null;
                            }
                            if (dragReleaseId) {
                                global.stage.disconnect(dragReleaseId);
                                dragReleaseId = null;
                            }

                            if (tabState === 'drag') {
                                // Verificar se está fora da barra de abas para agrupamento/separação
                                const [currentX, currentY] = releaseEvent.get_coords();
                                const [tabBarX, tabBarY] = this.get_transformed_position();
                                const tabBarWidth = this.get_width();
                                const tabBarHeight = this.get_height();

                                const isOverTabBar = currentX >= tabBarX && currentX <= tabBarX + tabBarWidth &&
                                    currentY >= tabBarY && currentY <= tabBarY + tabBarHeight;

                                if (!isOverTabBar) {
                                    // Fora da barra - verificar agrupamento ou separação
                                    const targetWindow = this.group.manager._getWindowUnder(window);

                                    if (targetWindow && !this.group.manager._areInSameGroup(window, targetWindow)) {
                                        // Agrupar com a janela alvo
                                        console.log(`[Tab Drop] Agrupando aba "${window.get_title()}" com janela "${targetWindow.get_title()}"`);
                                        this.group.manager._groupWindows(window, targetWindow);
                                    } else if (!targetWindow && this.group.windows.length > 1) {
                                        // Separar do grupo atual (apenas se o grupo tem mais de 1 janela)
                                        console.log(`[Tab Drop] Separando aba "${window.get_title()}" do grupo atual`);
                                        this._separateWindowFromGroup(window);
                                    } else {
                                        console.log(`[Tab Drop] Ação não aplicável para aba "${window.get_title()}"`);
                                    }

                                    // Esconder indicador de drop
                                    this.group.manager._hideDropIndicator();
                                } else {
                                    console.log(`[Tab Drop] Aba "${window.get_title()}" solta dentro da barra - mantendo no grupo`);
                                }

                                updateState('up', releaseEvent);
                                console.log(`[Drag End] Drag finalizado na aba "${window.get_title()}"`);
                                // Remover classe visual de drag
                                tab.remove_style_class_name('dragging');
                            } else if (tabState === 'down') {
                                updateState('click', releaseEvent);
                                console.log(`[Click] Clique registrado na aba "${window.get_title()}"`);
                                // Ativar a aba apenas se foi um clique
                                this._activateTab(window);
                                // Evitar bug de continaur movendo a aba após o drag
                                tab.remove_style_class_name('dragging');
                            } else {
                                updateState('up', releaseEvent);
                            }

                            // Reset para estado inicial após um pequeno delay
                            setTimeout(() => {
                                tabState = 'none';
                                console.log(`[State Reset] Aba "${window.get_title()}" voltou ao estado 'none'`);
                            }, 100);
                        }
                        return Clutter.EVENT_PROPAGATE;
                    });
                } else if (event.get_button() === 3) { // Botão direito do mouse
                    console.log(`[Right Click] Botão direito detectado na aba "${window.get_title()}"`);
                    // Criar menu de contexto
                    this._showContextMenu(window, event);
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_STOP;
            });

            // Conectar evento de mouse up local (backup)
            tab.connect('button-release-event', (actor, event) => {
                if (event.get_button() === 1) {
                    if (tabState === 'drag') {
                        updateState('up', event);
                        console.log(`[Drag End Local] Drag finalizado na aba "${window.get_title()}"`);
                        // Remover classe visual de drag
                        tab.remove_style_class_name('dragging');
                    } else if (tabState === 'down') {
                        updateState('click', event);
                        console.log(`[Click Local] Clique registrado na aba "${window.get_title()}"`);
                        // Ativar a aba apenas se foi um clique
                        this._activateTab(window);
                    } else {
                        updateState('up', event);
                    }
                }
                return Clutter.EVENT_PROPAGATE;
            });

            this.tabs.set(window, tab);
            this._tabContainer.add_child(tab);

            // Atualizar título quando a janela mudar
            window.connect('notify::title', () => {
                tab.tabLabel.text = window.get_title() || 'Janela';
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

        _showContextMenu(window, event) {
            console.log(`[Context Menu] Iniciando criação do menu para aba "${window.get_title()}"`);
            console.log(`[Context Menu] Grupo tem ${this.group.windows.length} janela(s)`);

            // Fechar menu existente se houver
            if (this._activeContextMenu) {
                console.log(`[Context Menu] Fechando menu anterior`);
                this._activeContextMenu.close();
                this._activeContextMenu = null;
            }

            // Só mostrar menu se o grupo tem mais de uma janela
            if (this.group.windows.length <= 1) {
                console.log(`[Context Menu] Não é possível sair do grupo - grupo tem apenas ${this.group.windows.length} janela(s)`);
                Main.notify(_('App Group Tabs'), _('Não é possível sair de um grupo com apenas uma janela'));
                return;
            }

            try {
                console.log(`[Context Menu] Criando PopupMenu...`);

                // Criar um botão temporário como source para o menu
                const sourceActor = new St.Widget({
                    reactive: true,
                    can_focus: true,
                    track_hover: true
                });

                // Adicionar o source actor temporariamente ao layout
                Main.uiGroup.add_child(sourceActor);

                // Posicionar o source actor na posição do cursor
                const [x, y] = event.get_coords();
                sourceActor.set_position(x, y);
                sourceActor.set_size(1, 1);

                // Criar menu de contexto usando o source actor
                const contextMenu = new PopupMenu.PopupMenu(sourceActor, 0.0, St.Side.TOP);
                this._activeContextMenu = contextMenu; // Armazenar referência

                console.log(`[Context Menu] Criando item do menu...`);
                // Adicionar item "Sair do Grupo"
                const leaveGroupItem = new PopupMenu.PopupMenuItem(_('Sair do Grupo'));
                leaveGroupItem.connect('activate', () => {
                    console.log(`[Context Menu] Item "Sair do Grupo" ativado`);
                    this._separateWindowFromGroup(window);
                    contextMenu.close();
                });
                contextMenu.addMenuItem(leaveGroupItem);

                console.log(`[Context Menu] Posicionando menu em (${x}, ${y})`);

                // Adicionar o menu ao Main.uiGroup para exibição
                console.log(`[Context Menu] Adicionando menu ao uiGroup...`);
                Main.uiGroup.add_child(contextMenu.actor);

                // Abrir o menu
                console.log(`[Context Menu] Abrindo menu...`);
                contextMenu.open();

                // Função para fechar o menu
                const closeMenu = () => {
                    console.log(`[Context Menu] Fechando menu via callback`);
                    if (contextMenu && !contextMenu._isDestroyed) {
                        contextMenu.close();
                    }
                };

                // Registrar o menu no GSM para detecção global de cliques
                const gsm = this.group.manager.extension._globalShellManager;
                let menuInfo = null;
                if (gsm) {
                    menuInfo = gsm.registerContextMenu(contextMenu, closeMenu);
                    console.log(`[Context Menu] Menu registrado no GSM`);
                }

                // Conectar evento para limpar quando o menu for fechado
                contextMenu.connect('open-state-changed', (menu, open) => {
                    if (!open) {
                        console.log(`[Context Menu] Menu fechado, limpando recursos`);

                        // Desregistrar do GSM
                        if (gsm && menuInfo) {
                            gsm.unregisterContextMenu(menuInfo);
                            console.log(`[Context Menu] Menu desregistrado do GSM`);
                        }

                        // Limpar recursos
                        if (contextMenu.actor && contextMenu.actor.get_parent()) {
                            Main.uiGroup.remove_child(contextMenu.actor);
                        }
                        if (sourceActor && sourceActor.get_parent()) {
                            Main.uiGroup.remove_child(sourceActor);
                        }
                        if (!contextMenu._isDestroyed) {
                            contextMenu.destroy();
                        }
                        if (!sourceActor._isDestroyed) {
                            sourceActor.destroy();
                        }
                        // Limpar referência ativa
                        if (this._activeContextMenu === contextMenu) {
                            this._activeContextMenu = null;
                        }
                    }
                });

                // Também fechar com ESC (mantido como backup)
                const keyPressId = global.stage.connect('key-press-event', (stage, keyEvent) => {
                    if (keyEvent.get_key_symbol() === Clutter.KEY_Escape) {
                        console.log(`[Context Menu] ESC pressionado, fechando menu`);
                        closeMenu();
                        global.stage.disconnect(keyPressId);
                    }
                    return Clutter.EVENT_PROPAGATE;
                });

                // Limpar listener de ESC quando menu fechar
                contextMenu.connect('open-state-changed', (menu, open) => {
                    if (!open && keyPressId) {
                        global.stage.disconnect(keyPressId);
                    }
                });

                console.log(`[Context Menu] Menu de contexto criado e aberto para aba "${window.get_title()}"`);
            } catch (error) {
                console.error(`[Context Menu] Erro ao criar menu: ${error}`);
                Main.notify(_('App Group Tabs'), _(`Erro ao criar menu: ${error}`));
                // Limpar referência em caso de erro
                this._activeContextMenu = null;
            }
        }

        _separateWindowFromGroup(window) {
            // Remover a janela do grupo atual e criar um novo grupo individual
            console.log(`[Tab Separation] Separando janela "${window.get_title()}" do grupo`);

            // Obter o grupo atual
            const currentGroup = this.group;
            const manager = currentGroup.manager;

            // Remover a janela do grupo atual
            currentGroup.removeWindow(window);

            // Criar um novo grupo individual apenas se a configuração estiver habilitada
            if (manager.singleWindowGroups) {
                const newGroup = new WindowGroup(manager);
                manager.groups.add(newGroup);

                newGroup.addWindow(window);
                manager.windowGroups.set(window, newGroup);

                console.log(`[Tab Separation] Janela "${window.get_title()}" separada em novo grupo`);
            } else {
                // Apenas remover do mapeamento de grupos, deixando a janela órfã
                manager.windowGroups.delete(window);
                console.log(`[Tab Separation] Janela "${window.get_title()}" separada e deixada sem grupo`);
            }
        }

        destroy() {
            // Fechar menu ativo se existir
            if (this._activeContextMenu) {
                console.log(`[TabBar Destroy] Fechando menu ativo`);
                this._activeContextMenu.close();
                this._activeContextMenu = null;
            }

            // Chamar destroy do parent
            super.destroy();
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
        this._syncingMaximization = false; // Flag para evitar loops de maximização
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
            window.connect('notify::maximized-horizontally', () => {
                this._updateTabBarVisibility();
                this._onWindowMaximizedChanged(window);
            }),
            window.connect('notify::maximized-vertically', () => {
                this._updateTabBarVisibility();
                this._onWindowMaximizedChanged(window);
            }),
            // Adicionar eventos para detectar mudanças de tiling
            window.connect('position-changed', () => this._updateTabBarVisibility()),
            window.connect('size-changed', () => this._updateTabBarVisibility())
        ];

        this._signals.push(...signals.map(id => ({ window, id })));

        this._updateTabBarVisibility();
        this.tabBar.updatePosition();

        // Aplicar tema correto à barra de abas
        const isLightTheme = this.manager._isLightTheme();
        this.manager._updateTabBarTheme(this.tabBar, isLightTheme);

        // Sincronizar posição da nova janela com a janela ativa do grupo
        const activeWindow = this.tabBar._activeTab || this.windows[0];
        if (activeWindow && activeWindow !== window && !activeWindow.minimized) {
            this._syncWindowPositions(activeWindow);
            // Sincronizar estado de maximização da nova janela
            this._syncWindowMaximization(activeWindow);
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
        } else if (this.windows.length === 1 && !this.manager.singleWindowGroups) {
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

    _onWindowMaximizedChanged(window) {
        console.log(`[Maximize Sync] Janela "${window.get_title()}" mudou estado de maximização`);
        // Sincronizar estado de maximização com outras janelas do grupo
        this._syncWindowMaximization(window);
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

    _syncWindowMaximization(changedWindow) {
        if (this._syncingMaximization) return; // Evitar loops infinitos

        // Flag para evitar loops durante sincronização
        this._syncingMaximization = true;

        console.log(`[Maximize Sync] Sincronizando maximização da janela "${changedWindow.get_title()}"`);

        // Obter o estado atual da janela que mudou
        const isMaximizedHorizontally = changedWindow.maximized_horizontally;
        const isMaximizedVertically = changedWindow.maximized_vertically;

        console.log(`[Maximize Sync] Estado: H=${isMaximizedHorizontally}, V=${isMaximizedVertically}`);

        // Aplicar o mesmo estado a todas as outras janelas do grupo
        this.windows.forEach(window => {
            if (window === changedWindow || window.minimized) return;

            console.log(`[Maximize Sync] Aplicando estado a "${window.get_title()}"`);

            // Aplicar o estado de maximização
            if (isMaximizedHorizontally && isMaximizedVertically) {
                // Maximizar completamente
                window.maximize(Meta.MaximizeFlags.BOTH);
                console.log(`[Maximize Sync] Maximizando "${window.get_title()}" completamente`);
            } else if (isMaximizedHorizontally) {
                // Maximizar apenas horizontalmente
                window.maximize(Meta.MaximizeFlags.HORIZONTAL);
                console.log(`[Maximize Sync] Maximizando "${window.get_title()}" horizontalmente`);
            } else if (isMaximizedVertically) {
                // Maximizar apenas verticalmente
                window.maximize(Meta.MaximizeFlags.VERTICAL);
                console.log(`[Maximize Sync] Maximizando "${window.get_title()}" verticalmente`);
            } else {
                // Desmaximizar
                window.unmaximize(Meta.MaximizeFlags.BOTH);
                console.log(`[Maximize Sync] Desmaximizando "${window.get_title()}"`);
            }
        });

        // Liberar a flag após um pequeno delay
        setTimeout(() => {
            this._syncingMaximization = false;
            console.log(`[Maximize Sync] Sincronização de maximização concluída`);
        }, 100);
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
                        // Primeira vez ou janela maximizadas, usar timeout normal
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

// Manager global para capturar eventos do shell E desktop
class GlobalShellManager {
    constructor() {
        this._globalMouseMotionId = null;
        this._globalButtonPressId = null;
        this._globalButtonReleaseId = null;
        this._mousePollingTimer = null;
        this._lastMousePosition = { x: -1, y: -1 };
        this._lastButtonState = null;
        this._dragThreshold = 5;
        this._activeDragClones = new Set(); // Rastrear clones ativos
        this._activeContextMenus = new Set(); // Rastrear menus de contexto ativos
    }

    enable() {
        console.log('[Global Shell Manager] Habilitando listeners globais');

        // Listener global de movimento do mouse (para áreas do Shell)
        this._globalMouseMotionId = global.stage.connect('motion-event', (stage, event) => {
            const [x, y] = event.get_coords();
            // console.log(`[GMM - Shell] Cursor: (${x}, ${y}), event: ${this._lastButtonState?.event}`);
            this._lastMousePosition = { x, y };

            // Verificar se está em estado 'down' e detectar movimento para 'drag'
            if (this._lastButtonState?.event === 'down' && this._lastButtonState?.pressed) {
                const deltaX = Math.abs(x - this._lastButtonState.x);
                const deltaY = Math.abs(y - this._lastButtonState.y);

                // Verificar se moveu mais que o threshold para considerar drag
                if (deltaX > this._dragThreshold || deltaY > this._dragThreshold) {
                    this._lastButtonState = {
                        button: this._lastButtonState.button,
                        pressed: this._lastButtonState.pressed,
                        x,
                        y,
                        event: 'drag'
                    };
                    console.log(`[Global Shell Manager] Estado mudou para 'drag' em (${x}, ${y})`);
                }
            }

            return Clutter.EVENT_PROPAGATE;
        });

        // Listener global de botão pressionado (para áreas do Shell)
        this._globalButtonPressId = global.stage.connect('button-press-event', (stage, event) => {
            const [x, y] = event.get_coords();
            const button = event.get_button();
            console.log(`[Global Button Press1 - Shell] Botão ${button} pressionado em (${x}, ${y})`);
            this._lastButtonState = { button, pressed: true, x, y, event: 'down' };

            // Verificar se deve fechar menus de contexto ativos
            if (this._activeContextMenus.size > 0) {
                const isInsideMenu = this._isClickInsideActiveMenu(x, y);
                if (!isInsideMenu) {
                    console.log(`[GSM] Clique fora dos menus detectado, fechando menus ativos`);
                    this.closeAllContextMenus();
                }
            }

            // Destruir clones ativos quando novo botão for pressionado
            this.destroyAllDragClones();
            return Clutter.EVENT_PROPAGATE;
        });

        // Listener global de botão solto (para áreas do Shell)
        this._globalButtonReleaseId = global.stage.connect('button-release-event', (stage, event) => {
            const [x, y] = event.get_coords();
            const button = event.get_button();
            console.log(`[Global Button Release - Shell] Botão ${button} solto em (${x}, ${y})`);
            if (this._lastButtonState?.button === button &&
                (this._lastButtonState?.event === 'down' || this._lastButtonState?.event === 'drag')) {
                this._lastButtonState = { button, pressed: false, x, y, event: 'up' };
                console.log(`[Global Shell Manager] Estado mudou para 'up' em (${x}, ${y})`);
            }
            // Destruir clones ativos quando botão for solto
            this.destroyAllDragClones();
            return Clutter.EVENT_PROPAGATE;
        });

        // Polling global para capturar movimento INCLUSIVE no desktop
        this._mousePollingTimer = setInterval(() => {
            const [x, y, mask] = global.get_pointer();

            // Verificar se a posição mudou
            if (x !== this._lastMousePosition.x || y !== this._lastMousePosition.y) {
                // console.log(`[GMM - Universal] Cursor: (${x}, ${y})`);
                this._lastMousePosition = { x, y };
            }

            // Verificar estado dos botões do mouse
            const leftPressed = (mask & Clutter.ModifierType.BUTTON1_MASK) !== 0;
            const middlePressed = (mask & Clutter.ModifierType.BUTTON2_MASK) !== 0;
            const rightPressed = (mask & Clutter.ModifierType.BUTTON3_MASK) !== 0;

            // Detectar mudanças de estado dos botões
            if (leftPressed && (!this._lastButtonState || !this._lastButtonState.pressed || this._lastButtonState.button !== 1)) {
                console.log(`[Global Button Press - Universal] Botão 1 pressionado em (${x}, ${y})`);
                // Destruir clones ativos quando novo botão for pressionado
                this.destroyAllDragClones();
                // Fechar menus de contexto ativos - verifica se o clique está dentro de algum menu
                if (this._activeContextMenus.size > 0) {
                    const isInsideMenu = this._isClickInsideActiveMenu(x, y);
                    if (!isInsideMenu) {
                        this.closeAllContextMenus();
                    }
                }
                this._lastButtonState = { button: 1, pressed: true, x, y, event: 'down' };
            } else if (!leftPressed && this._lastButtonState && this._lastButtonState.pressed && this._lastButtonState.button === 1) {
                console.log(`[Global Button Release - Universal] Botão 1 solto em (${x}, ${y})`);
                this._lastButtonState = { button: 1, pressed: false, x, y, event: 'up' };
                // Destruir clones ativos quando botão for solto
                this.destroyAllDragClones();
            } else if (leftPressed && this._lastButtonState && this._lastButtonState.pressed && this._lastButtonState.button === 1 && this._lastButtonState.event === 'down') {
                // Verificar se há movimento suficiente para considerar drag
                const deltaX = Math.abs(x - this._lastButtonState.x);
                const deltaY = Math.abs(y - this._lastButtonState.y);
                if (deltaX > this._dragThreshold || deltaY > this._dragThreshold) {
                    console.log(`[Global Drag - Universal] Botão 1 em drag em (${x}, ${y})`);
                    this._lastButtonState = { button: 1, pressed: true, x, y, event: 'drag' };
                }
            }

            if (rightPressed && (!this._lastButtonState || !this._lastButtonState.pressed || this._lastButtonState.button !== 3)) {
                console.log(`[Global Button Press - Universal] Botão 3 pressionado em (${x}, ${y})`);
                this._lastButtonState = { button: 3, pressed: true, x, y, event: 'down' };
            } else if (!rightPressed && this._lastButtonState && this._lastButtonState.pressed && this._lastButtonState.button === 3) {
                console.log(`[Global Button Release - Universal] Botão 3 solto em (${x}, ${y})`);
                this._lastButtonState = { button: 3, pressed: false, x, y, event: 'up' };
            } else if (rightPressed && this._lastButtonState && this._lastButtonState.pressed && this._lastButtonState.button === 3 && this._lastButtonState.event === 'down') {
                // Verificar se há movimento suficiente para considerar drag
                const deltaX = Math.abs(x - this._lastButtonState.x);
                const deltaY = Math.abs(y - this._lastButtonState.y);
                if (deltaX > this._dragThreshold || deltaY > this._dragThreshold) {
                    console.log(`[Global Drag - Universal] Botão 3 em drag em (${x}, ${y})`);
                    this._lastButtonState = { button: 3, pressed: true, x, y, event: 'drag' };
                }
            }

        }, 16); // ~60 FPS para rastreamento suave

        console.log('[Global Shell Manager] Listeners globais habilitados com sucesso');
    }

    disable() {
        console.log('[Global Shell Manager] Desabilitando listeners globais');

        if (this._globalMouseMotionId) {
            global.stage.disconnect(this._globalMouseMotionId);
            this._globalMouseMotionId = null;
            console.log('[Global Shell Manager] Listener de movimento desconectado');
        }

        if (this._globalButtonPressId) {
            global.stage.disconnect(this._globalButtonPressId);
            this._globalButtonPressId = null;
            console.log('[Global Shell Manager] Listener de botão press desconectado');
        }

        if (this._globalButtonReleaseId) {
            global.stage.disconnect(this._globalButtonReleaseId);
            this._globalButtonReleaseId = null;
            console.log('[Global Shell Manager] Listener de botão release desconectado');
        }

        // Parar polling universal do mouse
        if (this._mousePollingTimer) {
            clearInterval(this._mousePollingTimer);
            this._mousePollingTimer = null;
            console.log('[Global Shell Manager] Polling universal do mouse desabilitado');
        }

        // Destruir todos os clones ativos ao desabilitar
        this.destroyAllDragClones();

        // Fechar todos os menus de contexto ativos ao desabilitar
        this.closeAllContextMenus();
    }

    // Método para destruir todos os clones de drag ativos
    destroyAllDragClones() {
        console.log(`[GSM] Destruindo ${this._activeDragClones.size} clones. State: ${this._lastButtonState?.event || 'none'}`);
        this._activeDragClones.forEach(clone => {
            try {
                if (clone) {
                    Main.layoutManager.removeChrome(clone);
                    clone.destroy();
                }
            } catch (error) {
                console.warn('[Global Shell Manager] Erro ao destruir clone:', error);
            }
        });
        this._activeDragClones.clear();
    }

    // Método para registrar um clone de drag
    registerDragClone(clone) {
        this._activeDragClones.add(clone);
        console.warn(`[GSM] Clone adicionado. Total: ${this._activeDragClones.size}`);
    }

    // Método para desregistrar um clone de drag
    unregisterDragClone(clone) {
        this._activeDragClones.delete(clone);
        console.warn(`[GSM] Clone removido. Total: ${this._activeDragClones.size}`);
    }

    // Método para registrar um menu de contexto ativo
    registerContextMenu(menu, closeCallback) {
        const menuInfo = { menu, closeCallback };
        this._activeContextMenus.add(menuInfo);
        console.log(`[GSM] Menu de contexto registrado. Total: ${this._activeContextMenus.size}`);
        return menuInfo; // Retorna referência para poder desregistrar depois
    }

    // Método para desregistrar um menu de contexto
    unregisterContextMenu(menuInfo) {
        this._activeContextMenus.delete(menuInfo);
        console.log(`[GSM] Menu de contexto desregistrado. Total: ${this._activeContextMenus.size}`);
    }

    // Método para fechar todos os menus ativos
    closeAllContextMenus() {
        if (this._activeContextMenus.size > 0) {
            console.log(`[GSM] Fechando ${this._activeContextMenus.size} menu(s) de contexto`);
            this._activeContextMenus.forEach(menuInfo => {
                try {
                    if (menuInfo.closeCallback) {
                        menuInfo.closeCallback();
                    }
                } catch (error) {
                    console.warn('[GSM] Erro ao fechar menu:', error);
                }
            });
            this._activeContextMenus.clear();
        }
    }

    // Verificar se um clique está dentro de algum menu ativo
    _isClickInsideActiveMenu(clickX, clickY) {
        for (const menuInfo of this._activeContextMenus) {
            const menu = menuInfo.menu;
            if (menu && menu.actor && menu.actor.visible) {
                try {
                    const [menuX, menuY] = menu.actor.get_transformed_position();
                    const menuWidth = menu.actor.get_width();
                    const menuHeight = menu.actor.get_height();

                    const isInside = clickX >= menuX && clickX <= menuX + menuWidth &&
                        clickY >= menuY && clickY <= menuY + menuHeight;

                    if (isInside) {
                        return true;
                    }
                } catch (error) {
                    console.warn('[GSM] Erro ao verificar posição do menu:', error);
                }
            }
        }
        return false;
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
        this._themeSettings = null; // Configurações de tema
        this._themeSignalId = null; // Signal para mudanças de tema

        // Carregar configurações
        this._settings = extension.getSettings();
        this.requireCtrl = this._settings.get_boolean('require-ctrl');
        this.singleWindowGroups = this._settings.get_boolean('start-with-groups');

        // Conectar mudanças de configuração
        this._settingsId = this._settings.connect('changed::require-ctrl', () => {
            this.requireCtrl = this._settings.get_boolean('require-ctrl');
        });
        this._startGroupsSettingsId = this._settings.connect('changed::start-with-groups', () => {
            this.singleWindowGroups = this._settings.get_boolean('start-with-groups');
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
        if (this.singleWindowGroups) {
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

        // Configurar monitoramento de tema
        this._setupThemeMonitoring();

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

        // Desconectar listener global de movimento do mouse
        if (this._globalMouseMotionId) {
            global.stage.disconnect(this._globalMouseMotionId);
            this._globalMouseMotionId = null;
        }

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

        // Limpar monitoramento de tema
        this._cleanupThemeMonitoring();

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
        if (this.singleWindowGroups) {
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
        // Usar posição real do cursor ao invés do centro da janela arrastada
        const [cursorX, cursorY] = global.get_pointer();

        console.log(`[Window Detection] Buscando janela sob cursor em (${cursorX}, ${cursorY})`);

        // Obter janelas ordenadas por stack order (mais alta primeiro)
        const workspace = global.workspace_manager.get_active_workspace();
        const windows = workspace.list_windows()
            .filter(window =>
                window &&
                window !== draggedWindow &&
                window.window_type === Meta.WindowType.NORMAL &&
                window.showing_on_its_workspace() &&
                !window.minimized
            )
            .sort((a, b) => {
                // Ordenar por stack order - janelas mais altas primeiro
                return b.get_stable_sequence() - a.get_stable_sequence();
            });

        console.log(`[Window Detection] Verificando ${windows.length} janelas ordenadas por stack order`);

        // Verificar janelas na posição do cursor, começando pela mais alta
        for (const window of windows) {
            const rect = window.get_frame_rect();

            console.log(`[Window Detection] Testando "${window.get_title()}" - rect(${rect.x}, ${rect.y}, ${rect.width}x${rect.height})`);

            // Verificar se o cursor está sobre esta janela
            if (cursorX >= rect.x && cursorX <= rect.x + rect.width &&
                cursorY >= rect.y && cursorY <= rect.y + rect.height) {

                console.log(`[Window Detection] Cursor está sobre "${window.get_title()}"`);

                // Verificar se esta parte da janela está realmente visível
                // (não coberta por outras janelas mais altas)
                let isVisible = true;

                for (const upperWindow of windows) {
                    if (upperWindow === window) break; // Parar quando chegar na janela atual

                    const upperRect = upperWindow.get_frame_rect();

                    // Se uma janela mais alta cobre o cursor, a janela atual não é visível neste ponto
                    if (cursorX >= upperRect.x && cursorX <= upperRect.x + upperRect.width &&
                        cursorY >= upperRect.y && cursorY <= upperRect.y + upperRect.height) {
                        console.log(`[Window Detection] Cursor coberto por "${upperWindow.get_title()}" - não visível`);
                        isVisible = false;
                        break;
                    }
                }

                if (isVisible) {
                    console.log(`[Window Detection] ✓ Janela visível encontrada: "${window.get_title()}" na posição (${cursorX}, ${cursorY})`);
                    return window;
                } else {
                    console.log(`[Window Detection] ✗ Janela "${window.get_title()}" está coberta por outra janela`);
                }
            }
        }

        console.log(`[Window Detection] ✗ Nenhuma janela visível encontrada na posição (${cursorX}, ${cursorY})`);
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

    setSingleWindowGroups(value) {
        this.singleWindowGroups = value;
        // Salvar nas configurações
        this._settings.set_boolean('start-with-groups', value);

        // Se habilitou grupos automáticos, criar grupos para janelas sem grupo
        if (this.singleWindowGroups) {
            global.get_window_actors().forEach(actor => {
                const window = actor.get_meta_window();
                if (window &&
                    window.window_type === Meta.WindowType.NORMAL &&
                    !this.windowGroups.has(window)) {
                    this._createIndividualGroup(window);
                }
            });
        } else {
            // Se desabilitou, remover grupos com apenas uma janela
            this.groups.forEach(group => {
                if (group.windows.length === 1) {
                    this._removeGroup(group);
                }
            });
        }
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

    // Métodos para gerenciamento de tema
    _setupThemeMonitoring() {
        try {
            // Conectar às configurações de interface do GNOME
            this._themeSettings = new Gio.Settings({ schema: 'org.gnome.desktop.interface' });

            // Monitorar mudanças de tema GTK (método mais universal)
            this._themeSignalId = this._themeSettings.connect('changed::gtk-theme', () => {
                this._updateAllTabBarsTheme();
            });

            // Aplicar tema inicial
            this._updateAllTabBarsTheme();
        } catch (error) {
            console.log('App Group Tabs: Erro ao configurar monitoramento de tema:', error);
        }
    }

    _updateAllTabBarsTheme() {
        const isLightTheme = this._isLightTheme();
        this.groups.forEach(group => {
            this._updateTabBarTheme(group.tabBar, isLightTheme);
        });
    }

    _isLightTheme() {
        try {
            if (!this._themeSettings) return false;

            // Primeiro tentar color-scheme (GNOME 42+)
            try {
                const colorScheme = this._themeSettings.get_string('color-scheme');
                if (colorScheme === 'prefer-light') return true;
                if (colorScheme === 'prefer-dark') return false;
            } catch (e) {
                // color-scheme não existe, continuar com método alternativo
            }

            // Fallback: detectar pelo nome do tema GTK
            const gtkTheme = this._themeSettings.get_string('gtk-theme').toLowerCase();

            // Verificar nomes comuns de temas claros
            return gtkTheme.includes('light') ||
                (gtkTheme.includes('adwaita') && !gtkTheme.includes('dark')) ||
                gtkTheme.includes('breeze-light') ||
                gtkTheme.includes('yaru-light') ||
                gtkTheme === 'adwaita' ||
                gtkTheme === 'yaru' ||
                (gtkTheme.includes('yaru') && !gtkTheme.includes('dark'));

        } catch (error) {
            return false; // Fallback para tema escuro
        }
    }

    _updateTabBarTheme(tabBar, isLightTheme) {
        if (isLightTheme) {
            tabBar.add_style_class_name('light-theme');
        } else {
            tabBar.remove_style_class_name('light-theme');
        }
    }

    _cleanupThemeMonitoring() {
        if (this._themeSignalId && this._themeSettings) {
            this._themeSettings.disconnect(this._themeSignalId);
            this._themeSignalId = null;
        }
        this._themeSettings = null;
    }
}

export default class AppGroupTabsExtension extends Extension {
    enable() {
        this._tabManager = new TabManager(this);
        this._tabManager.enable();

        // Inicializar o gerenciador global de eventos do shell
        this._globalShellManager = new GlobalShellManager();
        this._globalShellManager.enable();

        // Adicionar indicador na barra superior
        this._indicator = new Indicator(this._tabManager);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        if (this._tabManager) {
            this._tabManager.disable();
            this._tabManager = null;
        }

        if (this._globalShellManager) {
            this._globalShellManager.disable();
            this._globalShellManager = null;
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
