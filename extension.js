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
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

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
        this.set_position(frame.x, frame.y - 40);
        this.set_size(frame.width, 40);
    }
    });

// Classe para gerenciar um grupo de janelas com abas
class WindowGroup {
    constructor(manager) {
        this.manager = manager;
        this.windows = [];
        this.tabBar = new TabBar(this);
        this._signals = [];

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
            window.connect('notify::minimized', () => this._onWindowMinimizedChanged(window))
        ];

        this._signals.push(...signals.map(id => ({ window, id })));

        this._updateTabBarVisibility();
        this.tabBar.updatePosition();
    }

    removeWindow(window) {
        const index = this.windows.indexOf(window);
        if (index === -1) return;

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
        }
    }

    _onWindowResized(window) {
        // Só atualizar posição se a janela não estiver minimizada
        if (!window.minimized && 
            (window === this.tabBar._activeTab || 
             (!this.tabBar._activeTab && this.windows[0] === window))) {
            this.tabBar.updatePosition();
        }
    }

    _onWindowFocused(window) {
        this.tabBar.setActiveWindow(window);
        this.tabBar.updatePosition();
    }

    _onWindowMinimizedChanged(window) {
        this._updateTabBarVisibility();
        this.tabBar.updatePosition();
    }

    _updateTabBarVisibility() {
        // Verificar se há pelo menos uma janela não minimizada no grupo
        const hasVisibleWindow = this.windows.some(window => !window.minimized);
        
        // Só mostrar a barra se houver janelas e pelo menos uma não estiver minimizada
        this.tabBar.visible = this.windows.length > 0 && hasVisibleWindow;
    }

    dissolve() {
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
    constructor() {
        this.groups = new Set();
        this.windowGroups = new Map(); // window -> group
        this._signals = [];
        this._dropIndicator = null;
        this._draggedWindow = null;
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

        // Processar janelas existentes e criar grupos individuais
        global.get_window_actors().forEach(actor => {
            const window = actor.get_meta_window();
            if (window && window.window_type === Meta.WindowType.NORMAL) {
                this._onWindowCreated(window);
                this._createIndividualGroup(window);
            }
        });

        this._createDropIndicator();
    }

    disable() {
        // Dissolver todos os grupos
        Array.from(this.groups).forEach(group => group.dissolve());

        // Desconectar sinais
        this._signals.forEach(id => global.display.disconnect(id));
        this._signals = [];

        this._destroyDropIndicator();
    }

    _onWindowCreated(window) {
        if (window.window_type !== Meta.WindowType.NORMAL) return;

        // Criar grupo individual para a nova janela
        this._createIndividualGroup(window);

        // Conectar evento de movimento para atualizar indicador
        window.connect('position-changed', () => this._onWindowMoved(window));
    }

    _onWindowMoved(window) {
        if (this._draggedWindow !== window) return;

        const targetWindow = this._getWindowUnder(window);
        if (targetWindow && targetWindow !== window &&
            !this._areInSameGroup(window, targetWindow)) {
            this._showDropIndicator(targetWindow);
        } else {
            this._hideDropIndicator();
        }
    }

    _onWindowDropped(window) {
        const targetWindow = this._getWindowUnder(window);
        if (targetWindow && targetWindow !== window &&
            !this._areInSameGroup(window, targetWindow)) {
            this._groupWindows(window, targetWindow);
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
}

export default class AppGroupTabsExtension extends Extension {
    enable() {
        this._tabManager = new TabManager();
        this._tabManager.enable();
    }

    disable() {
        if (this._tabManager) {
            this._tabManager.disable();
            this._tabManager = null;
        }
    }
}
