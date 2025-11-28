import { GAME_STATES, EDITOR_TOOLS } from './constants.js';

/**
 * UI 类，封装所有与 DOM 交互、事件绑定和 UI 更新的逻辑
 */
export class UI {
    constructor(game) {
        this.game = game; // 对主游戏类的引用

        // 缓存常用的DOM元素引用
        this.healthDisplay = document.getElementById('player-health-display');
        this.keysDisplay = document.getElementById('player-keys-display');
        this.stepsDisplay = document.getElementById('player-steps-display');
        this.ghostProximityDisplay = document.getElementById('ghost-proximity-display');
        this.mapSizeInput = document.getElementById('map-size-input');
        this.editorMapSizeInput = document.getElementById('editor-map-size-input');
        this.toastElement = document.getElementById('toast-notification');
        this.confirmOverlay = document.getElementById('confirm-overlay');
        this.confirmMessage = document.getElementById('confirm-message');
        this.confirmYesBtn = document.getElementById('confirm-yes-btn');
        this.confirmNoBtn = document.getElementById('confirm-no-btn');

        this.clearMapConfirmOverlay = document.getElementById('clear-map-confirm-overlay');
        this.clearEntitiesBtn = document.getElementById('confirm-clear-entities-btn');
        this.resetGridsBtn = document.getElementById('confirm-reset-grids-btn');
        this.clearGridsBtn = document.getElementById('confirm-clear-grids-btn');
        this.clearCancelBtn = document.getElementById('confirm-clear-cancel-btn');

        // D-pad 状态
        this.dpad = {
            element: document.getElementById('dpad-controls'),
            grip: document.getElementById('dpad-center'),
            isDragging: false,
            isResizing: false,
            startX: 0,
            startY: 0,
            initialLeft: 0,
            initialTop: 0,
            initialDist: 0,
            currentScale: 1
        };

        this.toastTimeout = null;
        this.dpadInterval = null;
    }

    /**
     * 绑定所有HTML元素的事件监听器
     */
    bindEvents() {
        const game = this.game;

        // Home 按钮
        document.getElementById('home-btn').addEventListener('click', () => {
            window.location.href = window.location.pathname;
        });

        // 游戏控制按钮
        document.getElementById('generate-map-btn').addEventListener('click', () => game.generateNewRandomMap());
        document.getElementById('reset-map-btn').addEventListener('click', () => game.resetCurrentMap());
        document.getElementById('edit-map-btn').addEventListener('click', () => game.enterEditorMode());

        // 分享码功能按钮
        document.getElementById('copy-share-code-btn').addEventListener('click', () => game.copyShareCode());
        document.getElementById('editor-copy-share-code-btn').addEventListener('click', () => game.copyShareCode(true));
        document.getElementById('load-share-code-btn').addEventListener('click', () => game._loadCodeFromClipboard(false));
        document.getElementById('editor-load-share-code-btn').addEventListener('click', () => game._loadCodeFromClipboard(true));

        // 调试视野开关
        document.getElementById('debug-vision-toggle').addEventListener('change', (e) => {
            game.debugVision = e.target.checked;
            game.draw();
            if (game.state === GAME_STATES.PLAYING) {
                this.updateProximityWarning();
            }
        });

        // 游戏模式选择
        document.getElementById('mode-exploration-btn').addEventListener('click', () => game.setGameMode('exploration'));
        document.getElementById('mode-death-loop-btn').addEventListener('click', () => game.setGameMode('death-loop'));
        document.getElementById('editor-mode-exploration-btn').addEventListener('click', () => game.setGameMode('exploration', true));
        document.getElementById('editor-mode-death-loop-btn').addEventListener('click', () => game.setGameMode('death-loop', true));

        // 游戏结束/胜利浮窗按钮
        document.getElementById('revive-btn').addEventListener('click', () => game.revivePlayer());
        document.getElementById('game-over-replay-btn').addEventListener('click', () => game.resetCurrentMap());
        document.getElementById('game-over-new-map-btn').addEventListener('click', () => game.generateNewRandomMap());
        document.getElementById('win-replay-btn').addEventListener('click', () => game.resetCurrentMap());
        document.getElementById('win-new-map-btn').addEventListener('click', () => game.generateNewRandomMap());

        // 编辑器工具栏
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', (e) => game.setEditorTool(e.target.id.split('-')[1]));
        });
        this.editorMapSizeInput.addEventListener('change', () => game.resizeAndClearEditor());
        document.getElementById('play-edited-map-btn').addEventListener('click', () => game.playEditedMap());
        document.getElementById('clear-map-btn').addEventListener('click', () => game.clearEditorMap());

        // 编辑模式切换
        document.getElementById('edit-type-regular-btn').addEventListener('click', () => game.attemptSetEditorMode('regular'));
        document.getElementById('edit-type-free-btn').addEventListener('click', () => game.attemptSetEditorMode('free'));

        // 图层模式切换
        document.getElementById('layer-mode-single-btn').addEventListener('click', () => game.setLayerMode(false));
        document.getElementById('layer-mode-multi-btn').addEventListener('click', () => game.setLayerMode(true));
        
        // 图层管理
        document.getElementById('layer-add-btn').addEventListener('click', () => game.addLayer());
        document.getElementById('layer-remove-btn').addEventListener('click', () => game.removeLayer());

        // 全局键盘事件
        window.addEventListener('keydown', (e) => game.handleKeyPress(e));
        
        // Canvas 鼠标/触摸事件
        const canvas = game.renderer.canvas;
        const touchWrapper = (handler) => (e) => { if(game.editor.active) { e.preventDefault(); handler(e.changedTouches[0]); }};
        
        canvas.addEventListener('click', (e) => game.handleCanvasClick(e));
        canvas.addEventListener('mousedown', (e) => game.handleCanvasMouseDown(e));
        canvas.addEventListener('mousemove', (e) => game.handleCanvasMouseMove(e));
        canvas.addEventListener('mouseup', (e) => game.handleCanvasMouseUp(e));
        canvas.addEventListener('mouseleave', (e) => game.handleCanvasMouseLeave(e));

        canvas.addEventListener('touchstart', touchWrapper(game.handleCanvasMouseDown.bind(game)), { passive: false });
        canvas.addEventListener('touchmove', touchWrapper(game.handleCanvasMouseMove.bind(game)), { passive: false });
        canvas.addEventListener('touchend', touchWrapper(game.handleCanvasMouseUp.bind(game)), { passive: false });
        canvas.addEventListener('touchcancel', touchWrapper(game.handleCanvasMouseUp.bind(game)), { passive: false });

        // D-pad
        this.bindDpadControls();
        document.getElementById('dpad-toggle').addEventListener('change', () => this.updateDpadVisibility());
        this.initializeDpadTouchControls();

        // 历史记录
        document.getElementById('undo-btn').addEventListener('click', () => game.handleUndo());
        document.getElementById('save-btn').addEventListener('click', () => game.handleSave());
        document.getElementById('rewind-btn').addEventListener('click', () => game.handleRewind());
    }

    /**
     * 更新所有UI显示，如生命、钥匙、步数等
     */
    updateUIDisplays() {
        const game = this.game;
        if (game.gameMode === 'exploration') {
            this.healthDisplay.textContent = `生命: ${game.player.hp}`;
            this.keysDisplay.textContent = `钥匙: ${game.player.keys}`;
            this.stepsDisplay.textContent = `步数: ${game.player.steps}`;
        } else { // death-loop
            document.getElementById('loop-count-display').textContent = `循环次数: ${game.loopCount}`;
            document.getElementById('player-keys-display-death-loop').textContent = `钥匙: ${game.player.keys}`;
            document.getElementById('player-stamina-display').textContent = `剩余体力: ${game.player.stamina}`;
        }
        this.updateProximityWarning();
    }

    /**
     * 更新周围鬼数量的警告显示和背景效果
     */
    updateProximityWarning() {
        const game = this.game;
        if (game.gameMode === 'death-loop') {
            document.body.classList.remove('danger-bg');
            this.ghostProximityDisplay.classList.remove('warning');
            return;
        }

        let totalNearbyGhosts = 0;
        let invisibleNearbyGhosts = 0;

        for (const ghost of game.ghosts) {
            const isNearby = Math.abs(ghost.x - game.player.x) <= 1 && Math.abs(ghost.y - game.player.y) <= 1;
            if (isNearby) {
                totalNearbyGhosts++;
                const isVisible = game.seenCells[ghost.y][ghost.x] || game.debugVision;
                if (!isVisible) {
                    invisibleNearbyGhosts++;
                }
            }
        }

        this.ghostProximityDisplay.textContent = `周围鬼数: ${totalNearbyGhosts}`;

        if (invisibleNearbyGhosts > 0) {
            document.body.classList.add('danger-bg');
            this.ghostProximityDisplay.classList.add('warning');
        } else {
            document.body.classList.remove('danger-bg');
            this.ghostProximityDisplay.classList.remove('warning');
        }
    }

    /**
     * 显示一个短暂的顶部通知 (Toast)
     */
    showToast(message, duration = 3000, type = 'info') {
        clearTimeout(this.toastTimeout);
        this.toastElement.classList.remove('show');

        setTimeout(() => {
            this.toastElement.textContent = message;
            this.toastElement.className = 'toast'; 
            if (type !== 'info') {
                this.toastElement.classList.add(type);
            }
            this.toastElement.classList.add('show');

            this.toastTimeout = setTimeout(() => {
                this.toastElement.classList.remove('show');
            }, duration);
        }, 100);
    }

    /**
     * 显示一个确认对话框
     */
    showConfirm(message, onConfirm) {
        this.confirmMessage.textContent = message;
        this.confirmOverlay.style.display = 'flex';

        const hide = () => {
            this.confirmOverlay.style.display = 'none';
            this.confirmYesBtn.onclick = null;
            this.confirmNoBtn.onclick = null;
        };

        this.confirmYesBtn.onclick = () => {
            hide();
            onConfirm();
        };
        this.confirmNoBtn.onclick = hide;
    }

    /**
     * 显示清空地图的四选项确认框
     */
    showClearMapConfirm() {
        this.clearMapConfirmOverlay.style.display = 'flex';

        const hide = () => {
            this.clearMapConfirmOverlay.style.display = 'none';
            this.clearEntitiesBtn.onclick = null;
            this.resetGridsBtn.onclick = null;
            this.clearGridsBtn.onclick = null;
            this.clearCancelBtn.onclick = null;
        };

        this.clearEntitiesBtn.onclick = () => {
            hide();
            this.game.clearEntitiesOnly();
        };
        this.resetGridsBtn.onclick = () => {
            hide();
            this.game.resetGridsAndClearEntities();
        };
        this.clearGridsBtn.onclick = () => {
            hide();
            this.game.clearAllGridsAndEntities();
        };
        this.clearCancelBtn.onclick = hide;
    }

    /**
     * 隐藏所有游戏状态浮窗
     */
    hideAllOverlays() {
        document.getElementById('death-overlay').style.display = 'none';
        document.getElementById('game-over-overlay').style.display = 'none';
        document.getElementById('win-overlay').style.display = 'none';
    }

    /**
     * 根据当前编辑模式更新UI工具的显隐
     */
    updateEditorUIForMode() {
        const isRegular = this.game.editor.mode === 'regular';
        document.getElementById('edit-type-regular-btn').classList.toggle('active', isRegular);
        document.getElementById('edit-type-free-btn').classList.toggle('active', !isRegular);
        
        document.getElementById('tool-start').style.display = isRegular ? 'none' : 'block';
        document.getElementById('tool-grid').style.display = isRegular ? 'none' : 'block';
        
        document.getElementById('layer-mode-container').style.display = isRegular ? 'none' : 'block';
        
        if (isRegular && this.game.multiLayerMode) {
            this.game.multiLayerMode = false;
            this.game.layerCount = 1;
            this.game.currentLayer = 0;
            this.updateLayerPanel();
        }
        
        if (isRegular && (this.game.editor.tool === EDITOR_TOOLS.GRID || this.game.editor.tool === EDITOR_TOOLS.START || this.game.editor.tool === EDITOR_TOOLS.STAIR)) {
            this.game.setEditorTool(EDITOR_TOOLS.WALL);
        }
        
        this.updateStairToolVisibility();
    }

    /**
     * 更新楼梯工具的显示状态
     */
    updateStairToolVisibility() {
        const stairBtn = document.getElementById('tool-stair');
        const shouldShow = this.game.editor.mode === 'free' && this.game.multiLayerMode;
        stairBtn.style.display = shouldShow ? 'block' : 'none';
        
        if (!shouldShow && this.game.editor.tool === EDITOR_TOOLS.STAIR) {
            this.game.setEditorTool(EDITOR_TOOLS.WALL);
        }
    }

    /**
     * 更新图层模式UI按钮状态
     */
    updateLayerModeUI() {
        document.getElementById('layer-mode-single-btn').classList.toggle('active', !this.game.multiLayerMode);
        document.getElementById('layer-mode-multi-btn').classList.toggle('active', this.game.multiLayerMode);
    }

    /**
     * 更新图层面板UI
     */
    updateLayerPanel() {
        const panel = document.getElementById('layer-panel');
        const container = document.getElementById('layer-buttons-container');
        const editControls = document.getElementById('layer-edit-controls');
        
        if (!this.game.multiLayerMode) {
            panel.style.display = 'none';
            return;
        }
        
        panel.style.display = 'flex';
        container.innerHTML = '';
        
        for (let i = this.game.layerCount - 1; i >= 0; i--) {
            const btn = document.createElement('button');
            btn.className = 'layer-btn';
            btn.textContent = (i + 1).toString();
            
            if (i === this.game.currentLayer) {
                btn.classList.add('active');
            }
            
            if (i === this.game.playerLayer) {
                btn.classList.add('player-layer');
            }
            
            btn.addEventListener('click', () => this.game.switchToLayer(i));
            container.appendChild(btn);
        }
        
        editControls.style.display = this.game.editor.active ? 'flex' : 'none';
    }

    /**
     * 更新撤销、存档、回溯按钮的可用状态
     */
    updateHistoryButtons() {
        const undoBtn = document.getElementById('undo-btn');
        const saveBtn = document.getElementById('save-btn');
        const rewindBtn = document.getElementById('rewind-btn');

        const canUndo = this.game.currentStep > 0 && !this.game.history[this.game.currentStep].isRevivalPoint;
        undoBtn.disabled = !canUndo;

        const lastCheckpoint = this.game.checkpoints.length > 0 ? this.game.checkpoints[this.game.checkpoints.length - 1] : -1;
        const canSave = this.game.currentStep > lastCheckpoint;
        saveBtn.disabled = !canSave;

        const canRewind = this.game.checkpoints.some(cp => cp < this.game.currentStep);
        rewindBtn.disabled = !canRewind;
    }

    // ================= D-pad Logic =================

    /**
     * 初始化虚拟方向键的拖动和缩放功能
     */
    initializeDpadTouchControls() {
        const dpad = this.dpad;

        const savedLeft = localStorage.getItem('dpadLeft');
        const savedTop = localStorage.getItem('dpadTop');
        const savedScale = localStorage.getItem('dpadScale');

        if (savedScale) {
            dpad.currentScale = parseFloat(savedScale);
            dpad.element.style.transform = `scale(${dpad.currentScale})`;
        }
        if (savedLeft && savedTop) {
            dpad.element.style.left = savedLeft;
            dpad.element.style.top = savedTop;
            dpad.element.style.right = 'auto';
            dpad.element.style.bottom = 'auto';
        }

        const ensureJsPositioning = () => {
            if (dpad.element.style.left === '' || dpad.element.style.top === '') {
                const rect = dpad.element.getBoundingClientRect();
                dpad.element.style.left = `${rect.left}px`;
                dpad.element.style.top = `${rect.top}px`;
                dpad.element.style.right = 'auto';
                dpad.element.style.bottom = 'auto';
            }
        };

        dpad.grip.addEventListener('touchstart', (e) => {
            const touches = e.touches;
            if (touches.length === 1) {
                e.preventDefault();
                ensureJsPositioning();
                dpad.isDragging = true;
                dpad.startX = touches[0].clientX;
                dpad.startY = touches[0].clientY;
                dpad.initialLeft = parseFloat(dpad.element.style.left);
                dpad.initialTop = parseFloat(dpad.element.style.top);
            }
        }, { passive: false });

        dpad.element.addEventListener('touchstart', (e) => {
            const touches = e.touches;
            if (touches.length === 2) {
                e.preventDefault();
                ensureJsPositioning();
                dpad.isResizing = true;
                const dx = touches[0].clientX - touches[1].clientX;
                const dy = touches[0].clientY - touches[1].clientY;
                dpad.initialDist = Math.sqrt(dx * dx + dy * dy);
            }
        }, { passive: false });

        document.addEventListener('touchmove', (e) => {
            if (!dpad.isDragging && !dpad.isResizing) return;
            e.preventDefault();
            const touches = e.touches;

            if (dpad.isDragging && touches.length === 1) {
                const dx = touches[0].clientX - dpad.startX;
                const dy = touches[0].clientY - dpad.startY;
                dpad.element.style.left = `${dpad.initialLeft + dx}px`;
                dpad.element.style.top = `${dpad.initialTop + dy}px`;
            } else if (dpad.isResizing && touches.length === 2) {
                const dx = touches[0].clientX - touches[1].clientX;
                const dy = touches[0].clientY - touches[1].clientY;
                const currentDist = Math.sqrt(dx * dx + dy * dy);
                const scaleChange = currentDist / dpad.initialDist;
                let newScale = dpad.currentScale * scaleChange;
                newScale = Math.max(0.5, Math.min(2.5, newScale));
                dpad.element.style.transform = `scale(${newScale})`;
            }
        }, { passive: false });

        document.addEventListener('touchend', (e) => {
            if (dpad.isResizing) {
                const transformStyle = dpad.element.style.transform;
                const scaleMatch = transformStyle.match(/scale\((.+)\)/);
                if (scaleMatch) {
                    dpad.currentScale = parseFloat(scaleMatch[1]);
                }
                localStorage.setItem('dpadScale', dpad.currentScale);
            }
            if (dpad.isDragging) {
                localStorage.setItem('dpadLeft', dpad.element.style.left);
                localStorage.setItem('dpadTop', dpad.element.style.top);
            }
            dpad.isDragging = false;
            dpad.isResizing = false;
        });
    }

    /**
     * 根据开关状态和游戏模式更新虚拟方向键的可见性
     */
    updateDpadVisibility() {
        const dpadToggle = document.getElementById('dpad-toggle');
        const dpadControls = document.getElementById('dpad-controls');
        const shouldShow = dpadToggle.checked && !this.game.editor.active;

        dpadControls.classList.toggle('hidden', !shouldShow);
    }

    /**
     * 绑定虚拟方向键按钮的触摸和点击事件
     */
    bindDpadControls() {
        const upBtn = document.getElementById('dpad-up');
        const downBtn = document.getElementById('dpad-down');
        const leftBtn = document.getElementById('dpad-left');
        const rightBtn = document.getElementById('dpad-right');
        const centerBtn = document.getElementById('dpad-center');

        const handleDpadPress = (dx, dy) => {
            if (this.game.state !== GAME_STATES.PLAYING) return;

            if (this.game.multiLayerMode && this.game.currentLayer !== this.game.playerLayer) {
                this.game.switchToLayer(this.game.playerLayer);
            }

            clearInterval(this.game.autoMoveInterval);
            clearInterval(this.dpadInterval);
            this.game.movePlayer(dx, dy);
            this.dpadInterval = setInterval(() => {
                this.game.movePlayer(dx, dy);
            }, 200);
        };

        const handleDpadRelease = () => {
            clearInterval(this.dpadInterval);
        };
        
        const handleCenterPress = () => {
            if (this.game.state !== GAME_STATES.PLAYING) return;

            if (this.game.multiLayerMode && this.game.currentLayer !== this.game.playerLayer) {
                this.game.switchToLayer(this.game.playerLayer);
            }

            this.game.useStair();
        };

        const addListeners = (element, dx, dy) => {
            element.addEventListener('touchstart', (e) => {
                e.preventDefault();
                handleDpadPress(dx, dy);
            });
            element.addEventListener('mousedown', () => handleDpadPress(dx, dy));
        };

        addListeners(upBtn, 0, -1);
        addListeners(downBtn, 0, 1);
        addListeners(leftBtn, -1, 0);
        addListeners(rightBtn, 1, 0);
        
        if (centerBtn) {
            centerBtn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                handleCenterPress();
            });
            centerBtn.addEventListener('mousedown', handleCenterPress);
        }

        document.addEventListener('touchend', handleDpadRelease);
        document.addEventListener('mouseup', handleDpadRelease);
    }
}
