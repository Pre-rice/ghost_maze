import { WALL_TYPES, GAME_STATES, EDITOR_TOOLS } from './constants.js';
import { MapDefinition } from './mapDefinition.js';
import { GameState } from './gameState.js';
import { DataSerializer } from './dataSerializer.js';
import { GameLogic } from './gameLogic.js';

// 监听DOM内容加载完成事件，确保在操作DOM之前所有元素都已准备好
document.addEventListener('DOMContentLoaded', () => {
    // ====== 三态主题切换：light / dark / auto ======
    const sunIcon = `
        <path d="M12 4.5V2m0 20v-2.5M4.93 4.93 3.51 3.51m16.98 16.98-1.42-1.42M4.5 12H2m20 0h-2.5M4.93 19.07l-1.42 1.42m16.98-16.98-1.42 1.42M12 7.5A4.5 4.5 0 1 1 7.5 12 4.505 4.505 0 0 1 12 7.5z"/>
    `;
    const moonIcon = `
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    `;
    const systemIcon = `
        <path d="M3 4h18v12H3z M8 20h8M10 16h4" stroke-width="2" stroke="currentColor" fill="none"/>
    `;
    const toggleBtn = document.getElementById("theme-toggle-btn");
    const themeIcon = document.getElementById("theme-icon");

    function applyTheme(mode) {
        document.documentElement.classList.remove("light", "dark");
        if (mode === "light") {
            document.documentElement.classList.add("light");
            themeIcon.innerHTML = sunIcon;
            toggleBtn.classList.remove("active");
        } else if (mode === "dark") {
            document.documentElement.classList.add("dark");
            themeIcon.innerHTML = moonIcon;
            toggleBtn.classList.add("active");
        } else {
            const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
            themeIcon.innerHTML = systemIcon;
            toggleBtn.classList.toggle("active", systemDark);
        }
    }

    let saved = localStorage.getItem("theme") || "auto";
    applyTheme(saved);

    document.getElementById("theme-toggle").addEventListener("click", () => {
        let current = localStorage.getItem("theme") || "auto";
        let next = current === "light" ? "dark" : current === "dark" ? "auto" : "light";
        applyTheme(next);
        localStorage.setItem("theme", next);
        if (typeof game !== 'undefined' && game) {
            game.refreshTheme();
        }
    });

    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');

    /**
     * 游戏主类，封装了所有游戏逻辑、状态和UI交互
     */
    class GhostMazeGame {
        constructor() {
            // 缓存常用的DOM元素引用，提高性能
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
            
            // 用于管理定时器和动画帧的ID
            this.toastTimeout = null;
            this.animationFrameId = null;
            this.autoMoveInterval = null;
            this.dpadInterval = null;

            // 为静态背景层创建离屏Canvas，用于性能优化
            this.staticLayerCanvas = document.createElement('canvas');
            this.staticLayerCtx = this.staticLayerCanvas.getContext('2d');
            
            // 从CSS变量中获取颜色值，便于在Canvas绘图中统一风格
            this.updateColors();
            
            // 核心游戏状态
            this.state = GAME_STATES.MENU;
            this.gameMode = 'exploration';
            this.initialHealth = 5;
            this.initialStamina = 100;
            this.loopCount = 0;
            this.width = 10;
            this.height = 10;
            this.padding = 15;
            this.cellSize = canvas.width / this.width;
            this.mapData = null;
            
            // 新架构：核心状态管理
            this.mapDefinition = null;  // MapDefinition 实例，不可变的地图定义
            this.currentGameState = null;  // GameState 实例，当前游戏状态
            this.viewLayer = 0;  // 当前显示的图层（与玩家所在层可能不同）

            // 新增：视口偏移（用于居中非标准地图）
            this.drawOffset = { x: 0, y: 0 };

            // 玩家状态（兼容旧代码）
            this.player = { x: 1, y: 1, hp: 5, stamina: 100, trail: [], keys: 0 , steps: 0};

            // 鬼和物品
            this.ghosts = [];
            this.ghostCount = 3;
            this.items = [];
            this.buttons = [];

            // 地图结构数据
            this.hWalls = [];
            this.vWalls = [];
            this.startPos = { x: 1, y: 1 };
            this.endPos = { x: 0, y: 0 };
            this.customStartPos = null; // 新增：自定义起点
            this.activeCells = []; // 新增：有效地图方格位图
            this.stairs = []; // 新增：楼梯数据 [{x, y, layer, direction: 'up'|'down'}]
            
            // 多层地图相关状态
            this.multiLayerMode = false; // 是否为多层地图模式
            this.layerCount = 1; // 当前图层数量
            this.currentLayer = 0; // 当前显示/编辑的图层（0-based索引，0是最底层）
            this.playerLayer = 0; // 玩家当前所在图层
            this.layers = []; // 存储所有图层数据的数组，每层包含 {hWalls, vWalls, activeCells, ghosts, items, buttons, stairs, endPos}
            
            // 视野系统
            this.seenCells = [];
            this.debugVision = false;

            // 编辑器状态
            this.editor = {
                active: false,
                mode: 'regular', // 'regular' or 'free'
                tool: EDITOR_TOOLS.WALL,
                isDragging: false,
                didDrag: false,
                dragAxis: null,
                lastDragPos: null,
                hoveredWall: null,
                hoveredButtonHotspot: null,
                gridDragAction: null, // 'add' or 'remove'
                stairPlacement: null // 楼梯放置状态 {x, y, direction: 'up'|'down'}
            };

            // 历史记录系统状态
            this.history = [];
            this.checkpoints = [];
            this.currentStep = -1;

            // 移动端虚拟方向键(D-pad)状态
            this.dpad = {
                element: document.getElementById('dpad-controls'),
                grip: document.getElementById('dpad-center'), // Fix 8: 中键替代grip
                isDragging: false,
                isResizing: false,
                startX: 0,
                startY: 0,
                initialLeft: 0,
                initialTop: 0,
                initialDist: 0,
                currentScale: 1
            };

            // 绑定所有UI事件并显示初始欢迎信息
            this.bindUI();
            this._initResizeListener();
            this.showInitialMessage();
            // 页面加载时尝试从 URL 查询参数或 hash 读取分享码
            this.loadShareCodeFromURL();
        }

        updateColors() {
            const computedStyle = getComputedStyle(document.documentElement);
            this.colors = {
                ground: computedStyle.getPropertyValue('--ground-color').trim(),
                gridLine: computedStyle.getPropertyValue('--grid-line-color').trim(),
                unexplored: computedStyle.getPropertyValue('--unexplored-color').trim(),
                wall: computedStyle.getPropertyValue('--wall-color').trim(),
                player: computedStyle.getPropertyValue('--player-color').trim(),
                ghost: computedStyle.getPropertyValue('--ghost-color').trim(),
                endPoint: computedStyle.getPropertyValue('--end-point-color').trim(),
                startPoint: computedStyle.getPropertyValue('--start-point-color').trim(),
                key: computedStyle.getPropertyValue('--key-color').trim(),
                startRoomHighlight: computedStyle.getPropertyValue('--start-room-highlight').trim(),
                hoverHighlight: computedStyle.getPropertyValue('--hover-highlight-color').trim(),
                text: computedStyle.getPropertyValue('--text-color').trim(),
                voidGrid: computedStyle.getPropertyValue('--void-grid-color').trim()
            };
        }

        refreshTheme() {
            this.updateColors();
            if (this.state === GAME_STATES.MENU) {
                this.showInitialMessage();
            } else {
                this._renderStaticLayer();
                this.draw();
            }
        }

        loadShareCodeFromURL() {
            const params = new URLSearchParams(window.location.search);
            let code = params.get("map");
            if (!code && window.location.hash) {
                code = window.location.hash.substring(1);
            }
            if (!code) return;
            this.showToast("检测到分享码，正在加载…", 2000);
            this.loadFromShareCode(code);
        }

        showInitialMessage() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.strokeStyle = this.colors.border || '#d9d9d9';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.strokeRect(this.padding, this.padding, canvas.width - 2 * this.padding, canvas.height - 2 * this.padding);
            ctx.setLineDash([]);
            ctx.fillStyle = this.colors.text;
            ctx.font = '20px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('点击 "随机生成新地图" 或加载分享码开始游戏', canvas.width / 2, canvas.height / 2);
        }

        /**
         * 显示一个短暂的顶部通知 (Toast)
         */
        showToast(message, duration = 3000, type = 'info') {
            clearTimeout(this.toastTimeout);
            this.toastElement.classList.remove('show');

            // 使用短暂延时来确保浏览器能重置CSS动画
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
         * 隐藏所有游戏状态浮窗
         */
        hideAllOverlays() {
            document.getElementById('death-overlay').style.display = 'none';
            document.getElementById('game-over-overlay').style.display = 'none';
            document.getElementById('win-overlay').style.display = 'none';
        }

        /**
         * 重置当前地图到初始状态
         */
        resetCurrentMap() {
            if (!this.mapData) {
                this.showToast("没有可重置的地图。请先生成一个新地图。", 3000, 'error');
                return;
            }
            this.startGame(this.mapData);
        }

        bindUI() {
            document.getElementById('home-btn').addEventListener('click', () => { window.location.href = window.location.pathname; });
            document.getElementById('generate-map-btn').addEventListener('click', () => this.generateNewRandomMap());
            document.getElementById('reset-map-btn').addEventListener('click', () => this.resetCurrentMap());
            document.getElementById('edit-map-btn').addEventListener('click', () => this.enterEditorMode());
            document.getElementById('copy-share-code-btn').addEventListener('click', () => this.copyShareCode());
            document.getElementById('editor-copy-share-code-btn').addEventListener('click', () => this.copyShareCode(true));
            document.getElementById('load-share-code-btn').addEventListener('click', () => this._loadCodeFromClipboard(false));
            document.getElementById('editor-load-share-code-btn').addEventListener('click', () => this._loadCodeFromClipboard(true));
            document.getElementById('debug-vision-toggle').addEventListener('change', (e) => {
                this.debugVision = e.target.checked;
                this.draw();
                if (this.state === GAME_STATES.PLAYING) { this.updateProximityWarning(); }
            });
            document.getElementById('mode-exploration-btn').addEventListener('click', () => this.setGameMode('exploration'));
            document.getElementById('mode-death-loop-btn').addEventListener('click', () => this.setGameMode('death-loop'));
            document.getElementById('editor-mode-exploration-btn').addEventListener('click', () => this.setGameMode('exploration', true));
            document.getElementById('editor-mode-death-loop-btn').addEventListener('click', () => this.setGameMode('death-loop', true));
            document.getElementById('revive-btn').addEventListener('click', () => this.revivePlayer());
            document.getElementById('game-over-replay-btn').addEventListener('click', () => this.resetCurrentMap());
            document.getElementById('game-over-new-map-btn').addEventListener('click', () => this.generateNewRandomMap());
            document.getElementById('win-replay-btn').addEventListener('click', () => this.resetCurrentMap());
            document.getElementById('win-new-map-btn').addEventListener('click', () => this.generateNewRandomMap());
            document.querySelectorAll('.tool-btn').forEach(btn => {
                btn.addEventListener('click', (e) => this.setEditorTool(e.target.id.split('-')[1]));
            });
            this.editorMapSizeInput.addEventListener('change', () => this.resizeAndClearEditor());
            document.getElementById('play-edited-map-btn').addEventListener('click', () => this.playEditedMap());
            document.getElementById('clear-map-btn').addEventListener('click', () => this.clearEditorMap());
            window.addEventListener('keydown', (e) => this.handleKeyPress(e));
            const touchWrapper = (handler) => (e) => { if (this.editor.active) { e.preventDefault(); handler(e.changedTouches[0]); } };
            canvas.addEventListener('click', (e) => this.handleCanvasClick(e));
            canvas.addEventListener('mousedown', (e) => this.handleCanvasMouseDown(e));
            canvas.addEventListener('mousemove', (e) => this.handleCanvasMouseMove(e));
            canvas.addEventListener('mouseup', (e) => this.handleCanvasMouseUp(e));
            canvas.addEventListener('mouseleave', (e) => this.handleCanvasMouseLeave(e));
            canvas.addEventListener('touchstart', touchWrapper(this.handleCanvasMouseDown.bind(this)), { passive: false });
            canvas.addEventListener('touchmove', touchWrapper(this.handleCanvasMouseMove.bind(this)), { passive: false });
            canvas.addEventListener('touchend', touchWrapper(this.handleCanvasMouseUp.bind(this)), { passive: false });
            canvas.addEventListener('touchcancel', touchWrapper(this.handleCanvasMouseUp.bind(this)), { passive: false });
            this.bindDpadControls();
            document.getElementById('dpad-toggle').addEventListener('change', (e) => { this.updateDpadVisibility(); });
            this.initializeDpadTouchControls();
            document.getElementById('undo-btn').addEventListener('click', () => this.handleUndo());
            document.getElementById('save-btn').addEventListener('click', () => this.handleSave());
            document.getElementById('rewind-btn').addEventListener('click', () => this.handleRewind());
            document.getElementById('edit-type-regular-btn').addEventListener('click', () => this.attemptSetEditorMode('regular'));
            document.getElementById('edit-type-free-btn').addEventListener('click', () => this.attemptSetEditorMode('free'));
            document.getElementById('layer-mode-single-btn').addEventListener('click', () => this.setLayerMode(false));
            document.getElementById('layer-mode-multi-btn').addEventListener('click', () => this.setLayerMode(true));
            document.getElementById('layer-add-btn').addEventListener('click', () => this.addLayer());
            document.getElementById('layer-remove-btn').addEventListener('click', () => this.removeLayer());
        }

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
                    if (scaleMatch) { dpad.currentScale = parseFloat(scaleMatch[1]); }
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

        setGameMode(newMode, fromEditor = false) {
            if (this.gameMode === newMode && !fromEditor) return;
            this.gameMode = newMode;
            const isExploration = newMode === 'exploration';
            document.getElementById('mode-exploration-btn').classList.toggle('active', isExploration);
            document.getElementById('mode-death-loop-btn').classList.toggle('active', !isExploration);
            document.getElementById('editor-mode-exploration-btn').classList.toggle('active', isExploration);
            document.getElementById('editor-mode-death-loop-btn').classList.toggle('active', !isExploration);
            document.getElementById('status-bar-exploration').style.display = isExploration ? 'flex' : 'none';
            document.getElementById('status-bar-death-loop').style.display = isExploration ? 'none' : 'flex';
            document.getElementById('initial-health-container').style.display = isExploration ? 'flex' : 'none';
            document.getElementById('initial-stamina-container').style.display = isExploration ? 'none' : 'flex';
            if (this.state !== GAME_STATES.MENU && this.state !== GAME_STATES.EDITOR) {
                this.resetCurrentMap();
            }
            this.updateUIDisplays();
        }

        updateDpadVisibility() {
            const dpadToggle = document.getElementById('dpad-toggle');
            const dpadControls = document.getElementById('dpad-controls');
            const shouldShow = dpadToggle.checked && !this.editor.active;
            dpadControls.classList.toggle('hidden', !shouldShow);
        }

        bindDpadControls() {
            const handleDpadPress = (dx, dy) => {
                if (this.state !== GAME_STATES.PLAYING) return;
                if (this.multiLayerMode && this.currentLayer !== this.playerLayer) {
                    this.switchToLayer(this.playerLayer);
                }
                clearInterval(this.autoMoveInterval);
                clearInterval(this.dpadInterval);
                this.movePlayer(dx, dy);
                this.dpadInterval = setInterval(() => { this.movePlayer(dx, dy); }, 200);
            };
            const handleDpadRelease = () => { clearInterval(this.dpadInterval); };
            const handleCenterPress = () => {
                if (this.state !== GAME_STATES.PLAYING) return;
                if (this.multiLayerMode && this.currentLayer !== this.playerLayer) {
                    this.switchToLayer(this.playerLayer);
                }
                this.useStair();
            };
            const addListeners = (element, dx, dy) => {
                element.addEventListener('touchstart', (e) => { e.preventDefault(); handleDpadPress(dx, dy); });
                element.addEventListener('mousedown', () => handleDpadPress(dx, dy));
            };
            addListeners(document.getElementById('dpad-up'), 0, -1);
            addListeners(document.getElementById('dpad-down'), 0, 1);
            addListeners(document.getElementById('dpad-left'), -1, 0);
            addListeners(document.getElementById('dpad-right'), 1, 0);
            const centerBtn = document.getElementById('dpad-center');
            if (centerBtn) {
                centerBtn.addEventListener('touchstart', (e) => { e.preventDefault(); handleCenterPress(); });
                centerBtn.addEventListener('mousedown', handleCenterPress);
            }
            document.addEventListener('touchend', handleDpadRelease);
            document.addEventListener('mouseup', handleDpadRelease);
        }

        startAnimationLoop() {
            if (this.animationFrameId) return;
            const trailLifetime = 500;
            const loop = () => {
                const now = Date.now();
                this.player.trail = this.player.trail.filter(p => now - p.timestamp < trailLifetime);
                this.ghosts.forEach(g => { g.trail = g.trail.filter(p => now - p.timestamp < trailLifetime); });
                if (this.state === GAME_STATES.PLAYING) {
                    this.draw();
                    this.animationFrameId = requestAnimationFrame(loop);
                } else {
                    this.stopAnimationLoop();
                }
            };
            this.animationFrameId = requestAnimationFrame(loop);
        }

        stopAnimationLoop() {
            if (this.animationFrameId) {
                cancelAnimationFrame(this.animationFrameId);
                this.animationFrameId = null;
            }
        }

        startGame(mapData) {
            this.stopAnimationLoop();
            this.mapData = JSON.parse(JSON.stringify(mapData));
            this.state = GAME_STATES.PLAYING;
            this.mapDefinition = new MapDefinition({
                ...mapData,
                gameMode: this.gameMode,
                initialHealth: this.initialHealth,
                initialStamina: this.initialStamina
            });
            this.currentGameState = GameLogic.createInitialState(this.mapDefinition);
            this.history = [this.currentGameState];
            this.checkpoints = [];
            this.currentStep = 0;
            this.width = mapData.width;
            this.height = mapData.height;
            this.padding = 15;
            this.cellSize = (canvas.width - 2 * this.padding) / this.width;
            this.startPos = { x: 1, y: this.height - 2 };
            this.editor.mode = mapData.editorMode || 'regular';
            this.activeCells = mapData.activeCells || Array(this.height).fill(null).map(() => Array(this.width).fill(true));
            this.customStartPos = mapData.customStartPos || mapData.mapStartPos || null;
            this.multiLayerMode = mapData.multiLayerMode || false;
            this.layerCount = mapData.layerCount || 1;
            this.stairs = JSON.parse(JSON.stringify(mapData.stairs || []));
            this.layers = JSON.parse(JSON.stringify(mapData.layers || []));
            this.playerLayer = this.currentGameState.player.layer;
            this.currentLayer = this.playerLayer;
            this.viewLayer = this.playerLayer;
            this._syncFromGameState();
            this.calculateDrawOffset();
            this._renderStaticLayer();
            this.updateUIDisplays();
            this.hideAllOverlays();
            this.updateLayerPanel();
            this.startAnimationLoop();
            setTimeout(() => {
                const result = this.generateShareCode();
                if (result.success) {
                    this.updateURLWithShareCode(result.code);
                }
            }, 0);
        }

        _syncFromGameState() {
            if (!this.currentGameState || !this.mapDefinition) return;
            const state = this.currentGameState;
            const mapDef = this.mapDefinition;
            const viewLayer = this.viewLayer;
            this.player = { ...state.player };
            this.playerLayer = state.player.layer;
            this.loopCount = state.loopCount;
            const layerDef = mapDef.layers[viewLayer];
            const layerState = state.layerStates[viewLayer];
            this.activeCells = layerDef.activeCells;
            this.hWalls = layerState.wallStates.h;
            this.vWalls = layerState.wallStates.v;
            this.ghosts = layerState.ghosts;
            this.items = layerState.items;
            this.buttons = layerDef.initialEntities.buttons;
            this.endPos = layerDef.initialEntities.endPos;
            this.customStartPos = layerDef.initialEntities.customStartPos;
            this.seenCells = state.seenCells[viewLayer];
            this.seenCellsPerLayer = state.seenCells;
        }

        processAction(action) {
            if ((this.state !== GAME_STATES.PLAYING && this.state !== GAME_STATES.DEAD) || !this.currentGameState || !this.mapDefinition) return;
            const prevState = this.currentGameState;
            const nextState = GameLogic.calculateNextState(prevState, action, this.mapDefinition);
            if (nextState === prevState) return;
            if (this.currentStep < this.history.length - 1) {
                this.history = this.history.slice(0, this.currentStep + 1);
                this.checkpoints = this.checkpoints.filter(cp => cp <= this.currentStep);
            }
            this.history.push(nextState);
            this.currentStep++;
            this.currentGameState = nextState;
            this.viewLayer = nextState.player.layer;
            this.currentLayer = this.viewLayer;
            this._syncFromGameState();
            this._renderStaticLayer();
            this.draw();
            this.updateUIDisplays();
            this.updateLayerPanel();
            this.updateHistoryButtons();
            if (nextState.isWon) { this.handleWin(); }
            else if (nextState.isDead) { this.handlePlayerDeath(nextState.deathReason); }
        }

        calculateDrawOffset() {
            if (this.state === GAME_STATES.EDITOR) { this.drawOffset = { x: 0, y: 0 }; return; }
            let minX = this.width, maxX = 0, minY = this.height, maxY = 0;
            let hasActive = false;
            const layersToCheck = this.multiLayerMode && this.layers.length > 0 ? this.layers : [{ activeCells: this.activeCells }];
            for (const layerData of layersToCheck) {
                if (!layerData || !layerData.activeCells) continue;
                for (let y = 0; y < this.height; y++) {
                    for (let x = 0; x < this.width; x++) {
                        if (layerData.activeCells[y] && layerData.activeCells[y][x]) {
                            hasActive = true;
                            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
                            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
                        }
                    }
                }
            }
            if (!hasActive) { this.drawOffset = { x: 0, y: 0 }; return; }
            const activeW = (maxX - minX + 1) * this.cellSize;
            const activeH = (maxY - minY + 1) * this.cellSize;
            const offsetX = (canvas.width - activeW) / 2 - (minX * this.cellSize);
            const offsetY = (canvas.height - activeH) / 2 - (minY * this.cellSize);
            this.drawOffset = { x: offsetX, y: offsetY };
        }

        generateNewRandomMap() {
            const size = parseInt(this.mapSizeInput.value);
            if (size < 8 || size > 20) {
                this.showToast('地图大小必须在 8 到 20 之间。', 3000, 'error');
                return;
            }
            // 随机地图总是使用默认的生命和体力值
            this.initialHealth = 5;
            this.initialStamina = 100;
            const mapData = this.generateMaze(size, size);
            // 随机地图总是常规模式
            mapData.editorMode = 'regular';
            mapData.activeCells = Array(size).fill(null).map(() => Array(size).fill(true));
            // 确保为单层地图正确设置 layers 数组
            mapData.multiLayerMode = false;
            mapData.layerCount = 1;
            mapData.layers = [{
                hWalls: mapData.hWalls,
                vWalls: mapData.vWalls,
                activeCells: mapData.activeCells,
                ghosts: mapData.initialGhosts,
                items: mapData.items,
                buttons: mapData.buttons,
                endPos: mapData.endPos,
                customStartPos: null
            }];
            this.startGame(mapData);
        }

        generateMaze(width, height) {
            this.width = width; this.height = height; this.padding = 15;
            this.cellSize = (canvas.width - 2 * this.padding) / this.width;
            const wall = () => ({ type: WALL_TYPES.SOLID, keys: 0 });
            const empty = () => ({ type: WALL_TYPES.EMPTY, keys: 0 });
            const door = () => ({ type: WALL_TYPES.DOOR, keys: 0 });
            this.hWalls = Array(height + 1).fill(null).map(() => Array(width).fill(null).map(wall));
            this.vWalls = Array(height).fill(null).map(() => Array(width + 1).fill(null).map(wall));
            const roomY = height - 3;
            for (let y = roomY; y < roomY + 3; y++) {
                for (let x = 0; x < 3; x++) {
                    if (x < 2) this.vWalls[y][x + 1] = empty();
                    if (y < roomY + 2) this.hWalls[y + 1][x] = empty();
                }
            }
            this.vWalls[roomY + 1][3] = door(); this.hWalls[roomY][1] = door();
            this.startPos = { x: 1, y: height - 2 };
            const visited = Array(height).fill(null).map(() => Array(width).fill(false));
            for (let y = roomY; y < roomY + 3; y++) { for (let x = 0; x < 3; x++) { visited[y][x] = true; } }
            const stack = [];
            let startGenX, startGenY;
            do { startGenX = Math.floor(Math.random() * width); startGenY = Math.floor(Math.random() * height); } while (visited[startGenY][startGenX]);
            stack.push({ x: startGenX, y: startGenY }); visited[startGenY][startGenX] = true;
            while (stack.length > 0) {
                const current = stack.pop(); const neighbors = [];
                const dirs = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
                for (const dir of dirs) {
                    const nx = current.x + dir.x, ny = current.y + dir.y;
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height && !visited[ny][nx]) { neighbors.push({ x: nx, y: ny, dir: dir }); }
                }
                if (neighbors.length > 0) {
                    stack.push(current);
                    const { x: nx, y: ny, dir } = neighbors[Math.floor(Math.random() * neighbors.length)];
                    if (dir.x === 1) this.vWalls[current.y][current.x + 1] = empty();
                    else if (dir.x === -1) this.vWalls[current.y][current.x] = empty();
                    else if (dir.y === 1) this.hWalls[current.y + 1][current.x] = empty();
                    else if (dir.y === -1) this.hWalls[current.y][current.x] = empty();
                    visited[ny][nx] = true; stack.push({ x: nx, y: ny });
                }
            }
            const wallsToRemove = Math.floor(width * height * 0.08); let removedCount = 0, attempts = 0;
            while (removedCount < wallsToRemove && attempts < wallsToRemove * 10) {
                attempts++; const rx = Math.floor(Math.random() * (width - 1)), ry = Math.floor(Math.random() * (height - 1));
                if (Math.random() > 0.5) {
                    if (rx < width - 1 && !(ry >= roomY && ry < roomY + 3 && rx + 1 === 3)) {
                        if (this.vWalls[ry][rx + 1].type === WALL_TYPES.SOLID) { this.vWalls[ry][rx + 1] = empty(); removedCount++; }
                    }
                } else {
                    if (ry < height - 1 && !(rx >= 0 && rx < 3 && ry + 1 === roomY)) {
                        if (this.hWalls[ry + 1][rx].type === WALL_TYPES.SOLID) { this.hWalls[ry + 1][rx] = empty(); removedCount++; }
                    }
                }
            }
            this.endPos = this.findFarthestEndCell();
            const doorProbability = 0.02;
            for (let y = 0; y < this.height; y++) {
                for (let x = 0; x < this.width; x++) {
                    const isNearEnd = (Math.abs(x - this.endPos.x) <= 1 && y === this.endPos.y) || (x === this.endPos.x && Math.abs(y - this.endPos.y) <= 1);
                    if (y < this.height - 1 && !this.isPosInStartRoom(x, y) && !this.isPosInStartRoom(x, y + 1) && !isNearEnd && Math.random() < doorProbability) this.hWalls[y + 1][x] = door();
                    if (x < width - 1 && !this.isPosInStartRoom(x, y) && !this.isPosInStartRoom(x + 1, y) && !isNearEnd && Math.random() < doorProbability) this.vWalls[y][x + 1] = door();
                }
            }
            const { x: ex, y: ey } = this.endPos; const lockedDoor = { type: WALL_TYPES.LOCKED, keys: 3 };
            if (this.hWalls[ey][ex].type === WALL_TYPES.EMPTY) this.hWalls[ey][ex] = lockedDoor;
            else if (this.hWalls[ey + 1][ex].type === WALL_TYPES.EMPTY) this.hWalls[ey + 1][ex] = lockedDoor;
            else if (this.vWalls[ey][ex].type === WALL_TYPES.EMPTY) this.vWalls[ey][ex] = lockedDoor;
            else if (this.vWalls[ey][ex + 1].type === WALL_TYPES.EMPTY) this.vWalls[ey][ex + 1] = lockedDoor;
            const occupied = new Set(); occupied.add(`${this.endPos.x},${this.endPos.y}`);
            for (let y = height - 3; y < height; y++) { for (let x = 0; x < 3; x++) { occupied.add(`${x},${y}`); } }
            const initialGhosts = [];
            while (initialGhosts.length < this.ghostCount) {
                const x = Math.floor(Math.random() * width), y = Math.floor(Math.random() * height), posKey = `${x},${y}`;
                if (!occupied.has(posKey)) { initialGhosts.push({ x, y, id: initialGhosts.length }); occupied.add(posKey); }
            }
            this.items = []; const keysToPlace = 4; const validCells = [], preferredCells = [];
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    if (!occupied.has(`${x},${y}`)) {
                        validCells.push({ x, y }); let wallCount = 0;
                        if (this.hWalls[y][x].type > 0) wallCount++; if (this.hWalls[y + 1][x].type > 0) wallCount++;
                        if (this.vWalls[y][x].type > 0) wallCount++; if (this.vWalls[y][x + 1].type > 0) wallCount++;
                        if (wallCount >= 3) { preferredCells.push({ x, y }); }
                    }
                }
            }
            for (let i = 0; i < keysToPlace; i++) {
                let pos = null;
                if (preferredCells.length > 0) { const index = Math.floor(Math.random() * preferredCells.length); pos = preferredCells.splice(index, 1)[0]; }
                else if (validCells.length > 0) { const index = Math.floor(Math.random() * validCells.length); pos = validCells.splice(index, 1)[0]; }
                if (pos) {
                    this.items.push({ x: pos.x, y: pos.y, type: 'key' });
                    const validIndex = validCells.findIndex(c => c.x === pos.x && c.y === pos.y);
                    if (validIndex > -1) validCells.splice(validIndex, 1);
                }
            }
            return { width, height, hWalls: this.hWalls, vWalls: this.vWalls, endPos: this.endPos, initialGhosts: initialGhosts, items: this.items, buttons: [] };
        }

        findFarthestEndCell() {
            const distances = this.calculateDistances(this.startPos);
            let maxDist = -1, farthestCell = null;
            for (let y = 0; y < this.height; y++) {
                for (let x = 0; x < this.width; x++) {
                    if (x === 0 || x === this.width - 1 || y === 0 || y === this.height - 1) {
                        let wallCount = 0;
                        if (this.hWalls[y][x].type > 0) wallCount++; if (this.hWalls[y + 1][x].type > 0) wallCount++;
                        if (this.vWalls[y][x].type > 0) wallCount++; if (this.vWalls[y][x + 1].type > 0) wallCount++;
                        if (wallCount >= 3 && distances[y][x] > maxDist) { maxDist = distances[y][x]; farthestCell = { x, y }; }
                    }
                }
            }
            return farthestCell || { x: this.width - 1, y: 0 };
        }

        handleKeyPress(e) {
            if (this.state !== GAME_STATES.PLAYING) return;
            this.stopAutoMove();
            if (this.multiLayerMode && this.currentLayer !== this.playerLayer) { this.switchToLayer(this.playerLayer); }
            let dx = 0, dy = 0;
            switch (e.key) {
                case 'ArrowUp': case 'w': dy = -1; break;
                case 'ArrowDown': case 's': dy = 1; break;
                case 'ArrowLeft': case 'a': dx = -1; break;
                case 'ArrowRight': case 'd': dx = 1; break;
                case ' ': e.preventDefault(); this.useStair(); return;
                default: return;
            }
            e.preventDefault(); this.movePlayer(dx, dy);
        }

        useStair() { if (this.multiLayerMode) { this.processAction({ type: 'USE_STAIR' }); } }
        movePlayer(dx, dy) { if (this.state === GAME_STATES.PLAYING) { this.processAction({ type: 'MOVE', payload: { dx, dy } }); } }
        pressButton(letter) { this.processAction({ type: 'PRESS_BUTTON', payload: { letter } }); }

        updateUIDisplays() {
            if (this.gameMode === 'exploration') {
                this.healthDisplay.textContent = `生命: ${this.player.hp}`;
                this.keysDisplay.textContent = `钥匙: ${this.player.keys}`;
                this.stepsDisplay.textContent = `步数: ${this.player.steps}`;
            } else {
                document.getElementById('loop-count-display').textContent = `循环次数: ${this.loopCount}`;
                document.getElementById('player-keys-display-death-loop').textContent = `钥匙: ${this.player.keys}`;
                document.getElementById('player-stamina-display').textContent = `剩余体力: ${this.player.stamina}`;
            }
            this.updateProximityWarning();
        }

        updateProximityWarning() {
            if (this.gameMode === 'death-loop') {
                document.body.classList.remove('danger-bg');
                this.ghostProximityDisplay.classList.remove('warning');
                return;
            }
            let totalNearbyGhosts = 0, invisibleNearbyGhosts = 0;
            for (const ghost of this.ghosts) {
                if (Math.abs(ghost.x - this.player.x) <= 1 && Math.abs(ghost.y - this.player.y) <= 1) {
                    totalNearbyGhosts++;
                    if (!this.seenCells[ghost.y][ghost.x] && !this.debugVision) { invisibleNearbyGhosts++; }
                }
            }
            this.ghostProximityDisplay.textContent = `周围鬼数: ${totalNearbyGhosts}`;
            document.body.classList.toggle('danger-bg', invisibleNearbyGhosts > 0);
            this.ghostProximityDisplay.classList.toggle('warning', invisibleNearbyGhosts > 0);
        }

        handlePlayerDeath(reason = 'ghost') {
            this.stopAutoMove(); this.stopAnimationLoop(); this.state = GAME_STATES.DEAD;
            this.draw();
            if (this.gameMode === 'exploration') {
                if (this.player.hp > 0) {
                    document.getElementById('death-message').textContent = `你死了 (剩余血量 ${this.player.hp})`;
                    document.getElementById('revive-btn').textContent = '复活';
                    document.getElementById('death-overlay').style.display = 'flex';
                } else {
                    document.getElementById('game-over-overlay').style.display = 'flex';
                }
            } else {
                const message = reason === 'stamina_depleted' ? '体力耗尽，你死了' : '你死了';
                document.getElementById('death-message').textContent = message;
                document.getElementById('revive-btn').textContent = '复活';
                document.getElementById('death-overlay').style.display = 'flex';
            }
        }

        revivePlayer() {
            this.processAction({ type: 'REVIVE' });
            this.state = GAME_STATES.PLAYING;
            this.hideAllOverlays();
            this.startAnimationLoop();
        }

        handleWin() {
            this.stopAutoMove(); this.stopAnimationLoop(); this.state = GAME_STATES.WON;
            const winStats = document.getElementById('win-stats');
            if (this.gameMode === 'exploration') {
                winStats.textContent = `你以 ${this.player.hp} 点剩余生命和 ${this.player.steps} 步的成绩通关！`;
            } else {
                winStats.textContent = `你以 ${this.loopCount} 次循环和 ${this.player.stamina} 点剩余体力的成绩通关！`;
            }
            document.getElementById('win-overlay').style.display = 'flex';
        }

        _renderStaticLayer() {
            this.staticLayerCanvas.width = canvas.width; this.staticLayerCanvas.height = canvas.height;
            const ctx = this.staticLayerCtx; const cs = this.cellSize;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            for (let y = 0; y < this.height; y++) {
                for (let x = 0; x < this.width; x++) {
                    if (this.activeCells[y] && this.activeCells[y][x]) {
                        ctx.fillStyle = this.colors.ground; ctx.fillRect(x * cs, y * cs, cs, cs);
                        ctx.strokeStyle = this.colors.gridLine; ctx.lineWidth = 1; ctx.strokeRect(x * cs, y * cs, cs, cs);
                    } else if (this.state === GAME_STATES.EDITOR) {
                        ctx.fillStyle = "rgba(0,0,0,0)"; ctx.strokeStyle = this.colors.voidGrid;
                        ctx.lineWidth = 0.5; ctx.setLineDash([2, 2]); ctx.strokeRect(x * cs, y * cs, cs, cs); ctx.setLineDash([]);
                    }
                }
            }
        }

        drawCorners(isEditor = false) {
            const cs = this.cellSize; const w = Math.max(2, cs / 10);
            ctx.fillStyle = this.colors.wall;
            const isActive = (cx, cy) => (cx >= 0 && cx < this.width && cy >= 0 && cy < this.height) ? this.activeCells[cy][cx] : false;
            const hasSolidWall = (type, wx, wy) => {
                if (type === 'h') {
                    if (wx < 0 || wx >= this.width) return false;
                    if (this.hWalls[wy] && this.hWalls[wy][wx] && this.hWalls[wy][wx].type === WALL_TYPES.SOLID) return true;
                    return isActive(wx, wy - 1) !== isActive(wx, wy);
                } else {
                    if (wy < 0 || wy >= this.height) return false;
                    if (this.vWalls[wy] && this.vWalls[wy][wx] && this.vWalls[wy][wx].type === WALL_TYPES.SOLID) return true;
                    return isActive(wx - 1, wy) !== isActive(wx, wy);
                }
            };
            for (let y = 0; y <= this.height; y++) {
                for (let x = 0; x <= this.width; x++) {
                    const hasHLeft = hasSolidWall('h', x - 1, y); const hasHRight = hasSolidWall('h', x, y);
                    const hasVUp = hasSolidWall('v', x, y - 1); const hasVDown = hasSolidWall('v', x, y);
                    const connectedCount = (hasHLeft ? 1 : 0) + (hasHRight ? 1 : 0) + (hasVUp ? 1 : 0) + (hasVDown ? 1 : 0);
                    if (connectedCount < 2) continue;
                    if (!isEditor && !this.debugVision) {
                        const isPureInternal = (x > 0 && x < this.width && y > 0 && y < this.height &&
                            isActive(x - 1, y - 1) && isActive(x, y - 1) && isActive(x - 1, y) && isActive(x, y));
                        if (isPureInternal && !(this.seenCells[y - 1][x - 1] || this.seenCells[y - 1][x] || this.seenCells[y][x - 1] || this.seenCells[y][x])) continue;
                    }
                    ctx.fillRect(x * cs - w / 2, y * cs - w / 2, w, w);
                }
            }
        }

        draw() {
            if (this.state === GAME_STATES.MENU) return;
            if (this.editor.active) { this.drawEditor(); return; }
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.save(); ctx.translate(this.drawOffset.x, this.drawOffset.y);
            const cs = this.cellSize; const now = Date.now();
            ctx.drawImage(this.staticLayerCanvas, 0, 0);
            const drawTrail = (arr, color) => arr.forEach(p => {
                if (this.seenCells[p.y][p.x] || this.debugVision) {
                    const age = now - p.timestamp; const alpha = 0.3 * (1 - age / 500);
                    this.drawCircle(p.x, p.y, color, alpha);
                }
            });
            drawTrail(this.player.trail, this.colors.player);
            this.ghosts.forEach(ghost => drawTrail(ghost.trail, this.colors.ghost));
            for (let y = 0; y < this.height; y++) {
                for (let x = 0; x < this.width; x++) {
                    if (this.activeCells[y][x] && !this.seenCells[y][x] && !this.debugVision) {
                        ctx.fillStyle = this.colors.unexplored; ctx.fillRect(x * cs, y * cs, cs, cs);
                    }
                }
            }
            ctx.beginPath();
            const shouldDrawBoundary = (bx, by, isH) => {
                if (isH) {
                    const up = (by > 0 && by <= this.height) ? this.activeCells[by-1][bx] : false;
                    const down = (by < this.height && by >= 0) ? this.activeCells[by][bx] : false;
                    return up !== down;
                } else {
                    const left = (bx > 0 && bx <= this.width) ? this.activeCells[by][bx-1] : false;
                    const right = (bx < this.width && bx >= 0) ? this.activeCells[by][bx] : false;
                    return left !== right;
                }
            };
            for (let y = 0; y <= this.height; y++) {
                for (let x = 0; x < this.width; x++) {
                    const isBoundary = shouldDrawBoundary(x, y, true);
                    const isActiveRow = (y < this.height && this.activeCells[y][x]) || (y > 0 && this.activeCells[y - 1][x]);
                    if (!isActiveRow && !isBoundary) continue;
                    const isVisible = isBoundary || this.debugVision || (y < this.height && this.activeCells[y][x] && this.seenCells[y][x]) || (y > 0 && this.activeCells[y - 1][x] && this.seenCells[y - 1][x]);
                    if (isVisible) {
                        if (this.hWalls[y][x].type > 0) this.drawWallOrDoor(x * cs, y * cs, (x + 1) * cs, y * cs, this.hWalls[y][x]);
                        else if (isBoundary) this.drawWallOrDoor(x * cs, y * cs, (x + 1) * cs, y * cs, { type: 1 });
                    }
                }
            }
            for (let y = 0; y < this.height; y++) {
                for (let x = 0; x <= this.width; x++) {
                    const isBoundary = shouldDrawBoundary(x, y, false);
                    const isActiveCol = (x < this.width && this.activeCells[y][x]) || (x > 0 && this.activeCells[y][x - 1]);
                    if (!isActiveCol && !isBoundary) continue;
                    const isVisible = isBoundary || this.debugVision || (x < this.width && this.activeCells[y][x] && this.seenCells[y][x]) || (x > 0 && this.activeCells[y][x - 1] && this.seenCells[y][x - 1]);
                    if (isVisible) {
                        if (this.vWalls[y][x].type > 0) this.drawWallOrDoor(x * cs, y * cs, x * cs, (y + 1) * cs, this.vWalls[y][x]);
                        else if (isBoundary) this.drawWallOrDoor(x * cs, y * cs, x * cs, (y + 1) * cs, { type: 1 });
                    }
                }
            }
            ctx.stroke();
            this.drawCorners(false);
            this.stairs.filter(s => s.layer === this.currentLayer).forEach(stair => {
                if (this.seenCells[stair.y][stair.x] || this.debugVision) { this.drawStair(stair); }
            });
            if (this.endPos && (this.seenCells[this.endPos.y][this.endPos.x] || this.debugVision)) { this.drawCircle(this.endPos.x, this.endPos.y, this.colors.endPoint); }
            this.ghosts.forEach(ghost => { if (this.seenCells[ghost.y][ghost.x] || this.debugVision) { this.drawCircle(ghost.x, ghost.y, this.colors.ghost); } });
            if (!this.multiLayerMode || this.currentLayer === this.playerLayer) { this.drawCircle(this.player.x, this.player.y, this.colors.player); }
            this.items.forEach(item => { if (this.seenCells[item.y][item.x] || this.debugVision) { this.drawItem(item); } });
            this.buttons.forEach(button => { if (this.seenCells[button.y][button.x] || this.debugVision) { this.drawButton(button); } });
            this.drawWallOverlays(true);
            ctx.restore();
        }

        drawWallOrDoor(x1, y1, x2, y2, wallObject, isHighlight = false) {
            const type = wallObject.type; const cs = this.cellSize;
            ctx.strokeStyle = isHighlight ? this.colors.hoverHighlight : this.colors.wall;
            ctx.lineWidth = isHighlight ? Math.max(3, cs / 8) : ([WALL_TYPES.LOCKED, WALL_TYPES.ONE_WAY].includes(type) ? Math.max(3, cs / 12) : Math.max(2, cs / 10));
            if (type === WALL_TYPES.SOLID) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
            else if (type === WALL_TYPES.GLASS) {
                const isHorizontal = y1 === y2; const lineLength = cs * 0.2; const offset = lineLength / 2;
                const points = [{ x: x1 * 5 / 6 + x2 * 1 / 6, y: y1 * 5 / 6 + y2 * 1 / 6 }, { x: (x1 + x2) / 2, y: (y1 + y2) / 2 }, { x: x1 * 1 / 6 + x2 * 5 / 6, y: y1 * 1 / 6 + y2 * 5 / 6 }];
                for (const p of points) {
                    if (isHorizontal) { ctx.moveTo(p.x - offset, p.y + offset); ctx.lineTo(p.x + offset, p.y - offset); }
                    else { ctx.moveTo(p.x - offset, p.y + offset); ctx.lineTo(p.x + offset, p.y - offset); }
                }
            } else if (type === WALL_TYPES.LOCKED || type === WALL_TYPES.ONE_WAY || type === WALL_TYPES.LETTER_DOOR) {
                let isLetterDoorOpen = (type === WALL_TYPES.LETTER_DOOR) && (this.state === GAME_STATES.EDITOR ? wallObject.initialState === 'open' : wallObject.currentState === 'open');
                if (isLetterDoorOpen) return;
                const isHorizontal = y1 === y2; const lockWidth = cs * 0.2;
                if (isHorizontal) { ctx.rect(x1, y1 - lockWidth / 2, cs, lockWidth); } else { ctx.rect(x1 - lockWidth / 2, y1, lockWidth, cs); }
            } else if (type === WALL_TYPES.DOOR) {
                const isHorizontal = y1 === y2; const length = isHorizontal ? x2 - x1 : y2 - y1; const gap = length / 3;
                if (isHorizontal) { ctx.moveTo(x1, y1); ctx.lineTo(x1 + gap, y1); ctx.moveTo(x2 - gap, y2); ctx.lineTo(x2, y2); }
                else { ctx.moveTo(x1, y1); ctx.lineTo(x1, y1 + gap); ctx.moveTo(x2, y2 - gap); ctx.lineTo(x2, y2); }
            }
        }

        drawArrow(x1, y1, x2, y2, direction, color, withStroke) {
            const centerX = (x1 + x2) / 2; const centerY = (y1 + y2) / 2; const cs = this.cellSize; const fontSize = cs * 0.6;
            ctx.save(); ctx.translate(centerX, centerY);
            if (direction.dx === 1) { ctx.rotate(0); } else if (direction.dx === -1) { ctx.rotate(Math.PI); }
            else if (direction.dy === 1) { ctx.rotate(Math.PI / 2); } else if (direction.dy === -1) { ctx.rotate(-Math.PI / 2); }
            ctx.scale(0.8, 1.0); ctx.font = `bold ${fontSize}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            if (withStroke) { ctx.strokeStyle = 'black'; ctx.lineWidth = 3; ctx.strokeText('>', 0, 0); }
            ctx.fillStyle = color; ctx.fillText('>', 0, 0); ctx.restore();
        }

        drawWallOverlays(inGame = false) {
            const cs = this.cellSize;
            const drawNumber = (x1, y1, x2, y2, number) => {
                const centerX = (x1 + x2) / 2; const centerY = (y1 + y2) / 2; const fontSize = cs * 0.4; const text = number.toString();
                ctx.font = `bold ${fontSize}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.strokeStyle = 'black'; ctx.lineWidth = 3; ctx.strokeText(text, centerX, centerY);
                ctx.fillStyle = this.colors.key; ctx.fillText(text, centerX, centerY);
            };
            for (let y = 1; y < this.height; y++) {
                for (let x = 0; x < this.width; x++) {
                    const w = this.hWalls[y][x];
                    if (!(this.activeCells[y][x] && this.activeCells[y - 1][x])) continue;
                    const isVisible = !inGame || this.debugVision || this.seenCells[y - 1][x] || this.seenCells[y][x];
                    if (isVisible) {
                        if (w.type === WALL_TYPES.LOCKED) { drawNumber(x * cs, y * cs, (x + 1) * cs, y * cs, w.keys); }
                        else if (w.type === WALL_TYPES.LETTER_DOOR) { drawNumber(x * cs, y * cs, (x + 1) * cs, y * cs, w.letter); }
                        else if (w.type === WALL_TYPES.ONE_WAY && w.direction) { this.drawArrow(x * cs, y * cs, (x + 1) * cs, y * cs, w.direction, this.colors.key, true); }
                    }
                }
            }
            for (let y = 0; y < this.height; y++) {
                for (let x = 1; x < this.width; x++) {
                    const w = this.vWalls[y][x];
                    if (!(this.activeCells[y][x] && this.activeCells[y][x - 1])) continue;
                    const isVisible = !inGame || this.debugVision || this.seenCells[y][x - 1] || this.seenCells[y][x];
                    if (isVisible) {
                        if (w.type === WALL_TYPES.LOCKED) { drawNumber(x * cs, y * cs, x * cs, (y + 1) * cs, w.keys); }
                        else if (w.type === WALL_TYPES.LETTER_DOOR) { drawNumber(x * cs, y * cs, x * cs, (y + 1) * cs, w.letter); }
                        else if (w.type === WALL_TYPES.ONE_WAY && w.direction) { this.drawArrow(x * cs, y * cs, x * cs, (y + 1) * cs, w.direction, this.colors.key, true); }
                    }
                }
            }
        }

        drawCircle(x, y, color, alpha = 1.0) {
            if (alpha <= 0) return; const cs = this.cellSize;
            ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.beginPath();
            ctx.arc(x * cs + cs / 2, y * cs + cs / 2, cs * 0.35, 0, 2 * Math.PI);
            ctx.fill(); ctx.globalAlpha = 1.0;
        }

        drawItem(item) {
            if (item.type === 'key') {
                const cs = this.cellSize; const centerX = item.x * cs + cs / 2; const centerY = item.y * cs + cs / 2; const size = cs * 0.3;
                ctx.fillStyle = this.colors.key; ctx.beginPath();
                ctx.moveTo(centerX, centerY - size); ctx.lineTo(centerX + size, centerY);
                ctx.lineTo(centerX, centerY + size); ctx.lineTo(centerX - size, centerY);
                ctx.closePath(); ctx.fill();
            }
        }

        drawStair(stair, isHighlight = false, alpha = 1.0) {
            const cs = this.cellSize; const centerX = stair.x * cs + cs / 2; const centerY = stair.y * cs + cs / 2;
            const scale = 0.8; const stairSize = cs * scale; const x = centerX - stairSize / 2; const y = centerY - stairSize / 2;
            const padding = stairSize * 0.08; const innerWidth = stairSize - 2 * padding; const innerHeight = stairSize - 2 * padding;
            const stepWidth = innerWidth / 3; const stepHeight = innerHeight / 3;
            ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = isHighlight ? this.colors.hoverHighlight : this.colors.wall;
            ctx.lineWidth = Math.max(2, cs / 15); ctx.beginPath();
            const left = x + padding, right = x + stairSize - padding, bottom = y + stairSize - padding, top = y + padding;
            if (stair.direction === 'up') {
                ctx.moveTo(left, bottom); ctx.lineTo(left, bottom - stepHeight); ctx.lineTo(left + stepWidth, bottom - stepHeight);
                ctx.lineTo(left + stepWidth, bottom - 2 * stepHeight); ctx.lineTo(left + 2 * stepWidth, bottom - 2 * stepHeight);
                ctx.lineTo(left + 2 * stepWidth, top); ctx.lineTo(right, top); ctx.lineTo(right, bottom); ctx.lineTo(left, bottom);
            } else {
                ctx.moveTo(left, bottom); ctx.lineTo(left, top); ctx.lineTo(left + stepWidth, top);
                ctx.lineTo(left + stepWidth, top + stepHeight); ctx.lineTo(left + 2 * stepWidth, top + stepHeight);
                ctx.lineTo(left + 2 * stepWidth, top + 2 * stepHeight); ctx.lineTo(right, top + 2 * stepHeight);
                ctx.lineTo(right, bottom); ctx.lineTo(left, bottom);
            }
            ctx.stroke(); ctx.restore();
        }

        drawButton(button, isHighlight = false) {
            const cs = this.cellSize; const centerX = button.x * cs + cs / 2; const centerY = button.y * cs + cs / 2;
            const buttonLength = cs * 0.5; const buttonWidth = cs * 0.2;
            let p1, p2, p3, p4, letterCenterX, letterCenterY;
            const setPoints = (x1, y1, x2, y2, x3, y3, x4, y4, lcx, lcy) => {
                p1 = { x: x1, y: y1 }; p2 = { x: x2, y: y2 }; p3 = { x: x3, y: y3 }; p4 = { x: x4, y: y4 };
                letterCenterX = lcx; letterCenterY = lcy;
            };
            if (button.direction.dy === -1) setPoints(centerX - buttonLength / 2, button.y * cs, centerX + buttonLength / 2, button.y * cs, centerX + buttonLength / 2, button.y * cs + buttonWidth, centerX - buttonLength / 2, button.y * cs + buttonWidth, centerX, button.y * cs + buttonWidth / 2);
            else if (button.direction.dy === 1) setPoints(centerX - buttonLength / 2, (button.y + 1) * cs - buttonWidth, centerX + buttonLength / 2, (button.y + 1) * cs - buttonWidth, centerX + buttonLength / 2, (button.y + 1) * cs, centerX - buttonLength / 2, (button.y + 1) * cs, centerX, (button.y + 1) * cs - buttonWidth / 2);
            else if (button.direction.dx === -1) setPoints(button.x * cs, centerY - buttonLength / 2, button.x * cs + buttonWidth, centerY - buttonLength / 2, button.x * cs + buttonWidth, centerY + buttonLength / 2, button.x * cs, centerY + buttonLength / 2, button.x * cs + buttonWidth / 2, centerY);
            else if (button.direction.dx === 1) setPoints((button.x + 1) * cs - buttonWidth, centerY - buttonLength / 2, (button.x + 1) * cs, centerY - buttonLength / 2, (button.x + 1) * cs, centerY + buttonLength / 2, (button.x + 1) * cs - buttonWidth, centerY + buttonLength / 2, (button.x + 1) * cs - buttonWidth / 2, centerY);
            ctx.strokeStyle = isHighlight ? this.colors.hoverHighlight : this.colors.wall;
            ctx.lineWidth = isHighlight ? Math.max(3, cs / 8) : Math.max(2, cs / 10);
            ctx.beginPath();
            if (button.direction.dy === -1) { ctx.moveTo(p1.x, p1.y); ctx.lineTo(p4.x, p4.y); ctx.lineTo(p3.x, p3.y); ctx.lineTo(p2.x, p2.y); }
            else if (button.direction.dy === 1) { ctx.moveTo(p4.x, p4.y); ctx.lineTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); }
            else if (button.direction.dx === -1) { ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y); }
            else if (button.direction.dx === 1) { ctx.moveTo(p2.x, p2.y); ctx.lineTo(p1.x, p1.y); ctx.lineTo(p4.x, p4.y); ctx.lineTo(p3.x, p3.y); }
            ctx.stroke();
            if (!isHighlight && button.letter) {
                const fontSize = cs * 0.4; ctx.font = `bold ${fontSize}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.strokeStyle = 'black'; ctx.lineWidth = 3; ctx.strokeText(button.letter, letterCenterX, letterCenterY);
                ctx.fillStyle = this.colors.key; ctx.fillText(button.letter, letterCenterX, letterCenterY);
            }
        }

        enterEditorMode() {
            this.stopAnimationLoop();
            if (!this.mapData) {
                this.width = 10; this.height = 10; this.editor.mode = 'regular'; this.multiLayerMode = false;
                this.layerCount = 1; this.currentLayer = 0; this.stairs = [];
                this.createBlankEditorMap();
                this.mapData = {
                    width: this.width, height: this.height, hWalls: JSON.parse(JSON.stringify(this.hWalls)), vWalls: JSON.parse(JSON.stringify(this.vWalls)),
                    endPos: null, initialGhosts: [], items: [], activeCells: this.activeCells, editorMode: 'regular',
                    multiLayerMode: false, layerCount: 1, layers: [], stairs: []
                };
            }
            this.state = GAME_STATES.EDITOR; this.editor.active = true; this.setEditorTool(EDITOR_TOOLS.WALL);
            document.getElementById('game-controls').style.display = 'none';
            document.getElementById('editor-controls').style.display = 'block';
            this.width = this.mapData.width; this.height = this.mapData.height;
            this.startPos = { x: 1, y: this.height - 2 };
            this.customStartPos = this.mapData.customStartPos || null;
            if (this.mapData.multiLayerMode && this.mapData.layers) {
                this.customStartPos = null;
                for (let i = 0; i < this.mapData.layers.length; i++) {
                    if (this.mapData.layers[i] && this.mapData.layers[i].customStartPos) { this.customStartPos = this.mapData.layers[i].customStartPos; break; }
                }
            }
            this.activeCells = this.mapData.activeCells || Array(this.height).fill(null).map(() => Array(this.width).fill(true));
            this.editor.mode = this.mapData.editorMode || 'regular';
            this.multiLayerMode = this.mapData.multiLayerMode || false;
            this.layerCount = this.mapData.layerCount || 1;
            this.currentLayer = 0;
            this.stairs = JSON.parse(JSON.stringify(this.mapData.stairs || []));
            this.layers = JSON.parse(JSON.stringify(this.mapData.layers || []));
            if (this.multiLayerMode && this.layers.length > 0) {
                let startLayerIndex = typeof this.mapData.playerStartLayer === 'number' && this.mapData.playerStartLayer < this.layerCount ? this.mapData.playerStartLayer : 0;
                if (startLayerIndex === 0) {
                    for (let i = 0; i < this.layers.length; i++) { if (this.layers[i] && this.layers[i].customStartPos) { startLayerIndex = i; break; } }
                }
                this.currentLayer = startLayerIndex; this.playerLayer = startLayerIndex;
                const layerData = this.layers[this.currentLayer];
                if (layerData) {
                    this.hWalls = layerData.hWalls; this.vWalls = layerData.vWalls; this.endPos = layerData.endPos;
                    this.ghosts = layerData.ghosts; this.items = layerData.items; this.buttons = layerData.buttons;
                    this.activeCells = layerData.activeCells; this.customStartPos = layerData.customStartPos;
                }
            } else {
                this.hWalls = JSON.parse(JSON.stringify(this.mapData.hWalls)); this.vWalls = JSON.parse(JSON.stringify(this.mapData.vWalls));
                this.endPos = this.mapData.endPos ? { ...this.mapData.endPos } : null;
                this.ghosts = JSON.parse(JSON.stringify(this.mapData.initialGhosts || []));
                this.items = JSON.parse(JSON.stringify(this.mapData.items || []));
                this.buttons = JSON.parse(JSON.stringify(this.mapData.buttons || []));
            }
            this.editorMapSizeInput.value = this.width; this.padding = 15;
            this.cellSize = (canvas.width - 2 * this.padding) / this.width;
            this.updateEditorUIForMode(); this.updateLayerModeUI(); this.updateLayerPanel();
            this._renderStaticLayer(); this.drawEditor(); this.updateDpadVisibility();
        }

        updateLayerModeUI() {
            document.getElementById('layer-mode-single-btn').classList.toggle('active', !this.multiLayerMode);
            document.getElementById('layer-mode-multi-btn').classList.toggle('active', this.multiLayerMode);
        }

        attemptSetEditorMode(mode) {
            if (this.editor.mode === mode) return;
            this.showConfirm(`切换编辑模式将清空当前地图，确定吗？`, () => {
                this.editor.mode = mode;
                if (mode === 'free') { this.resetGridsAndClearEntities(); }
                else { this.createBlankEditorMap(); this._renderStaticLayer(); this.drawEditor(); }
                this.updateEditorUIForMode();
            });
        }

        updateEditorUIForMode() {
            const isRegular = this.editor.mode === 'regular';
            document.getElementById('edit-type-regular-btn').classList.toggle('active', isRegular);
            document.getElementById('edit-type-free-btn').classList.toggle('active', !isRegular);
            document.getElementById('tool-start').style.display = isRegular ? 'none' : 'block';
            document.getElementById('tool-grid').style.display = isRegular ? 'none' : 'block';
            document.getElementById('layer-mode-container').style.display = isRegular ? 'none' : 'block';
            if (isRegular && this.multiLayerMode) {
                this.multiLayerMode = false; this.layerCount = 1; this.currentLayer = 0;
                this.updateLayerPanel();
            }
            if (isRegular && [EDITOR_TOOLS.GRID, EDITOR_TOOLS.START, EDITOR_TOOLS.STAIR].includes(this.editor.tool)) {
                this.setEditorTool(EDITOR_TOOLS.WALL);
            }
            this.updateStairToolVisibility();
        }

        updateStairToolVisibility() {
            const stairBtn = document.getElementById('tool-stair');
            const shouldShow = this.editor.mode === 'free' && this.multiLayerMode;
            stairBtn.style.display = shouldShow ? 'block' : 'none';
            if (!shouldShow && this.editor.tool === EDITOR_TOOLS.STAIR) { this.setEditorTool(EDITOR_TOOLS.WALL); }
        }

        setLayerMode(isMultiLayer) {
            if (this.multiLayerMode === isMultiLayer) return;
            if (!isMultiLayer && this.layerCount > 1) {
                this.showConfirm('地图只会保留第一层的内容，确定吗？', () => { this._applyLayerMode(false); });
            } else { this._applyLayerMode(isMultiLayer); }
        }

        _applyLayerMode(isMultiLayer) {
            this.multiLayerMode = isMultiLayer;
            document.getElementById('layer-mode-single-btn').classList.toggle('active', !isMultiLayer);
            document.getElementById('layer-mode-multi-btn').classList.toggle('active', isMultiLayer);
            if (isMultiLayer) {
                this.layerCount = 1; this.currentLayer = 0; this.playerLayer = 0; this.stairs = [];
                this.layers = [{
                    hWalls: this.hWalls, vWalls: this.vWalls, activeCells: this.activeCells, ghosts: this.ghosts,
                    items: this.items, buttons: this.buttons, stairs: [], endPos: this.endPos, customStartPos: this.customStartPos
                }];
            } else {
                if (this.layers.length > 0) {
                    const firstLayer = this.layers[0];
                    this.hWalls = firstLayer.hWalls; this.vWalls = firstLayer.vWalls; this.activeCells = firstLayer.activeCells;
                    this.ghosts = firstLayer.ghosts; this.items = firstLayer.items; this.buttons = firstLayer.buttons;
                    this.endPos = firstLayer.endPos; this.customStartPos = firstLayer.customStartPos;
                }
                this.layerCount = 1; this.currentLayer = 0; this.playerLayer = 0; this.stairs = []; this.layers = [];
            }
            this.updateLayerPanel(); this.updateStairToolVisibility();
            this._renderStaticLayer(); this.drawEditor();
        }

        addLayer() {
            if (this.layerCount >= 10) { this.showToast('最多只能添加10层地图！', 3000, 'error'); return; }
            const empty = () => ({ type: WALL_TYPES.EMPTY, keys: 0 });
            const newLayer = {
                hWalls: Array(this.height + 1).fill(null).map(() => Array(this.width).fill(null).map(empty)),
                vWalls: Array(this.height).fill(null).map(() => Array(this.width + 1).fill(null).map(empty)),
                activeCells: Array(this.height).fill(null).map(() => Array(this.width).fill(true)),
                ghosts: [], items: [], buttons: [], stairs: [], endPos: null, customStartPos: null
            };
            this.layers.push(newLayer); this.layerCount++;
            this.updateLayerPanel(); this.showToast(`已添加第 ${this.layerCount} 层`, 2000, 'success');
        }

        removeLayer() {
            if (this.layerCount <= 1) { this.showToast('初始的1层不可删除！', 3000, 'error'); return; }
            this.showConfirm(`确定要删除第 ${this.layerCount} 层吗？`, () => {
                this.layers.pop(); this.layerCount--;
                const removedLayerIndex = this.layerCount;
                for (let i = 0; i < this.layers.length; i++) {
                    this.layers[i].stairs = this.layers[i].stairs.filter(s => !(s.direction === 'up' && i === removedLayerIndex - 1));
                }
                if (this.currentLayer >= this.layerCount) {
                    this.currentLayer = this.layerCount - 1;
                    this._switchToLayer(this.currentLayer);
                }
                this.updateLayerPanel(); this.showToast(`已删除第 ${this.layerCount + 1} 层`, 2000, 'success');
            });
        }

        switchToLayer(layerIndex) {
            if (layerIndex === this.currentLayer || layerIndex < 0 || layerIndex >= this.layerCount) return;
            if (this.state === GAME_STATES.EDITOR) {
                this._saveCurrentLayerData(); this._switchToLayer(layerIndex);
                this._renderStaticLayer(); this.drawEditor();
            } else if ([GAME_STATES.PLAYING, GAME_STATES.DEAD, GAME_STATES.WON].includes(this.state)) {
                this.viewLayer = layerIndex; this.currentLayer = layerIndex;
                if (this.currentGameState && this.mapDefinition) {
                    const layerDef = this.mapDefinition.layers[layerIndex];
                    const layerState = this.currentGameState.layerStates[layerIndex];
                    this.activeCells = layerDef.activeCells; this.hWalls = layerState.wallStates.h; this.vWalls = layerState.wallStates.v;
                    this.ghosts = layerState.ghosts; this.items = layerState.items; this.buttons = layerDef.initialEntities.buttons;
                    this.endPos = layerDef.initialEntities.endPos; this.customStartPos = layerDef.initialEntities.customStartPos;
                    this.seenCells = this.currentGameState.seenCells[layerIndex];
                }
                this._renderStaticLayer(); this.draw();
            }
            this.updateLayerPanel();
        }

        _saveCurrentLayerData() {
            if (!this.multiLayerMode || this.layers.length === 0) return;
            this.layers[this.currentLayer] = {
                hWalls: this.hWalls, vWalls: this.vWalls, activeCells: this.activeCells, ghosts: this.ghosts,
                items: this.items, buttons: this.buttons, stairs: this.stairs.filter(s => s.layer === this.currentLayer),
                endPos: this.endPos, customStartPos: this.customStartPos
            };
        }

        _switchToLayer(layerIndex) {
            this.currentLayer = layerIndex;
            if (this.layers[layerIndex]) {
                const layer = this.layers[layerIndex];
                this.hWalls = layer.hWalls; this.vWalls = layer.vWalls; this.activeCells = layer.activeCells;
                this.ghosts = layer.ghosts; this.items = layer.items; this.buttons = layer.buttons;
                this.endPos = layer.endPos; this.customStartPos = layer.customStartPos;
            }
        }

        updateLayerPanel() {
            const panel = document.getElementById('layer-panel');
            if (!this.multiLayerMode) { panel.style.display = 'none'; return; }
            panel.style.display = 'flex';
            this._positionLayerPanel();
            const container = document.getElementById('layer-buttons-container');
            container.innerHTML = '';
            for (let i = this.layerCount - 1; i >= 0; i--) {
                const btn = document.createElement('button');
                btn.className = 'layer-btn'; btn.textContent = (i + 1).toString();
                if (i === this.currentLayer) btn.classList.add('active');
                if (i === this.playerLayer) btn.classList.add('player-layer');
                btn.addEventListener('click', () => this.switchToLayer(i));
                container.appendChild(btn);
            }
            document.getElementById('layer-edit-controls').style.display = this.editor.active ? 'flex' : 'none';
        }

        _positionLayerPanel() { }
        _initResizeListener() { }

        createBlankEditorMap() {
            this.padding = 15; this.cellSize = (canvas.width - 2 * this.padding) / this.width;
            const wall = () => ({ type: WALL_TYPES.SOLID, keys: 0 });
            const empty = () => ({ type: WALL_TYPES.EMPTY, keys: 0 });
            const door = () => ({ type: WALL_TYPES.DOOR, keys: 0 });
            this.hWalls = Array(this.height + 1).fill(null).map(() => Array(this.width).fill(null).map(empty));
            this.vWalls = Array(this.height).fill(null).map(() => Array(this.width + 1).fill(null).map(empty));
            this.customStartPos = null;
            this.activeCells = Array(this.height).fill(null).map(() => Array(this.width).fill(true));
            if (this.editor.mode === 'regular') {
                for (let x = 0; x < this.width; x++) { this.hWalls[0][x] = wall(); this.hWalls[this.height][x] = wall(); }
                for (let y = 0; y < this.height; y++) { this.vWalls[y][0] = wall(); this.vWalls[y][this.width] = wall(); }
                const roomY = this.height - 3;
                for (let x = 0; x < 3; x++) this.hWalls[roomY + 3][x] = wall();
                for (let y = roomY; y < roomY + 3; y++) this.vWalls[y][0] = wall();
                this.hWalls[roomY][0] = wall(); this.hWalls[roomY][2] = wall();
                this.vWalls[roomY][3] = wall(); this.vWalls[roomY + 2][3] = wall();
                this.hWalls[roomY][1] = door(); this.vWalls[roomY + 1][3] = door();
            }
            this.startPos = { x: 1, y: this.height - 2 };
            this.endPos = null; this.ghosts = []; this.items = []; this.buttons = []; this.stairs = [];
            if (this.multiLayerMode) {
                this.layers = [{
                    hWalls: this.hWalls, vWalls: this.vWalls, activeCells: this.activeCells, ghosts: [], items: [],
                    buttons: [], stairs: [], endPos: null, customStartPos: null
                }];
                this.layerCount = 1; this.currentLayer = 0;
            }
        }

        _createEmptyWalls(type, width, height) {
            const empty = () => ({ type: WALL_TYPES.EMPTY, keys: 0 });
            return type === 'h' ? Array(height + 1).fill(null).map(() => Array(width).fill(null).map(empty))
                : Array(height).fill(null).map(() => Array(width + 1).fill(null).map(empty));
        }

        resizeAndClearEditor() {
            const size = parseInt(this.editorMapSizeInput.value);
            if (size < 8 || size > 20) {
                this.showToast('地图大小必须在 8 到 20 之间。', 3000, 'error');
                this.editorMapSizeInput.value = this.width; return;
            }
            const savedLayerCount = this.multiLayerMode ? this.layerCount : 1;
            const wasMultiLayer = this.multiLayerMode;
            this.width = size; this.height = size;
            this.createBlankEditorMap();
            if (wasMultiLayer && savedLayerCount > 1) {
                this.multiLayerMode = true; this.layerCount = savedLayerCount; this.currentLayer = 0;
                this.playerLayer = 0; this.stairs = []; this.layers = [];
                for (let i = 0; i < savedLayerCount; i++) {
                    this.layers.push({
                        hWalls: this._createEmptyWalls('h', size, size), vWalls: this._createEmptyWalls('v', size, size),
                        activeCells: Array(size).fill(null).map(() => Array(size).fill(true)),
                        ghosts: [], items: [], buttons: [], stairs: [], endPos: null, customStartPos: null
                    });
                }
                const firstLayer = this.layers[0];
                this.hWalls = firstLayer.hWalls; this.vWalls = firstLayer.vWalls; this.activeCells = firstLayer.activeCells;
                this.ghosts = firstLayer.ghosts; this.items = firstLayer.items; this.buttons = firstLayer.buttons;
                this.updateLayerPanel();
            }
            this._renderStaticLayer(); this.drawEditor();
        }

        playEditedMap() {
            if (this.multiLayerMode) { this._saveCurrentLayerData(); }
            if (this.editor.mode === 'free') {
                let hasStartPoint = false, startLayer = 0;
                if (this.multiLayerMode) {
                    for (let i = 0; i < this.layerCount; i++) {
                        if (this.layers[i] && this.layers[i].customStartPos) { hasStartPoint = true; startLayer = i; break; }
                    }
                } else { hasStartPoint = !!this.customStartPos; }
                if (!hasStartPoint) { this.showToast('自由模式必须设置起点！', 3000, 'error'); return; }
                this.playerLayer = startLayer;
            }
            this.editor.active = false;
            document.getElementById('game-controls').style.display = 'block';
            document.getElementById('editor-controls').style.display = 'none';
            this.initialHealth = parseInt(document.getElementById('editor-initial-health').value) || 5;
            this.initialStamina = parseInt(document.getElementById('editor-initial-stamina').value) || 100;
            if (this.multiLayerMode) { this._saveCurrentLayerData(); }
            const editedMapData = {
                width: this.width, height: this.height, hWalls: this.hWalls, vWalls: this.vWalls, endPos: this.endPos,
                initialGhosts: this.ghosts.map((g, i) => ({ x: g.x, y: g.y, id: i })), items: this.items, buttons: this.buttons,
                activeCells: this.activeCells, editorMode: this.editor.mode, customStartPos: this.customStartPos,
                multiLayerMode: this.multiLayerMode, layerCount: this.layerCount,
                layers: JSON.parse(JSON.stringify(this.layers)), stairs: JSON.parse(JSON.stringify(this.stairs))
            };
            this.startGame(editedMapData);
            this.updateDpadVisibility();
        }

        updateURLWithShareCode(code) {
            if (!code) return;
            const url = new URL(window.location.href);
            url.searchParams.set('map', code); url.hash = '';
            window.history.replaceState({}, "", url.toString());
        }

        clearEntitiesOnly() {
            const empty = () => ({ type: WALL_TYPES.EMPTY, keys: 0 });
            this.hWalls = Array(this.height + 1).fill(null).map(() => Array(this.width).fill(null).map(empty));
            this.vWalls = Array(this.height).fill(null).map(() => Array(this.width + 1).fill(null).map(empty));
            this.endPos = null; this.customStartPos = null; this.ghosts = []; this.items = []; this.buttons = [];
            this.drawEditor();
        }

        clearAllGridsAndEntities() {
            this.activeCells = Array(this.height).fill(null).map(() => Array(this.width).fill(false));
            this.clearEntitiesOnly(); this._renderStaticLayer(); this.drawEditor();
        }

        resetGridsAndClearEntities() {
            this.activeCells = Array(this.height).fill(null).map(() => Array(this.width).fill(true));
            this.clearEntitiesOnly(); this._renderStaticLayer(); this.drawEditor();
        }

        showClearMapConfirm() {
            this.clearMapConfirmOverlay.style.display = 'flex';
            const hide = () => {
                this.clearMapConfirmOverlay.style.display = 'none';
                this.clearEntitiesBtn.onclick = null; this.resetGridsBtn.onclick = null;
                this.clearGridsBtn.onclick = null; this.clearCancelBtn.onclick = null;
            };
            this.clearEntitiesBtn.onclick = () => { hide(); this.clearEntitiesOnly(); };
            this.resetGridsBtn.onclick = () => { hide(); this.resetGridsAndClearEntities(); };
            this.clearGridsBtn.onclick = () => { hide(); this.clearAllGridsAndEntities(); };
            this.clearCancelBtn.onclick = hide;
        }

        clearEditorMap() {
            if (this.editor.mode === 'free') { this.showClearMapConfirm(); }
            else { this.showConfirm('你确定要清空所有墙壁、实体和物品吗？', () => { this.createBlankEditorMap(); this.drawEditor(); }); }
        }

        setEditorTool(tool) {
            this.editor.tool = tool;
            document.querySelectorAll('.tool-btn').forEach(btn => { btn.classList.toggle('active', btn.id === `tool-${tool}`); });
            this.editor.hoveredWall = null; this.drawEditor();
        }

        drawEditor() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.save(); ctx.translate(this.padding, this.padding);
            const cs = this.cellSize;
            ctx.drawImage(this.staticLayerCanvas, 0, 0);
            if (this.editor.mode === 'free') {
                ctx.beginPath(); ctx.strokeStyle = this.colors.voidGrid; ctx.lineWidth = 1; ctx.setLineDash([5, 5]);
                for (let y = 0; y < this.height; y++) { for (let x = 0; x < this.width; x++) { if (!this.activeCells[y][x]) { ctx.strokeRect(x * cs, y * cs, cs, cs); } } }
                ctx.strokeRect(0, 0, this.width * cs, this.height * cs); ctx.setLineDash([]);
            }
            if (this.editor.mode === 'regular') { ctx.fillStyle = this.colors.startRoomHighlight; ctx.fillRect(0, (this.height - 3) * cs, 3 * cs, 3 * cs); }
            ctx.beginPath();
            const shouldDrawBoundary = (bx, by, isH) => {
                if (isH) {
                    const up = (by > 0) ? this.activeCells[by - 1][bx] : false;
                    const down = (by < this.height) ? this.activeCells[by][bx] : false;
                    return up !== down;
                } else {
                    const left = (bx > 0) ? this.activeCells[by][bx - 1] : false;
                    const right = (bx < this.width) ? this.activeCells[by][bx] : false;
                    return left !== right;
                }
            };
            for (let y = 0; y <= this.height; y++) {
                for (let x = 0; x < this.width; x++) {
                    const isActiveRow = (y < this.height && this.activeCells[y][x]) || (y > 0 && this.activeCells[y - 1][x]);
                    if (!isActiveRow) continue;
                    if (this.hWalls[y][x].type > 0) this.drawWallOrDoor(x * cs, y * cs, (x + 1) * cs, y * cs, this.hWalls[y][x]);
                    else if (this.editor.mode === 'free' && shouldDrawBoundary(x, y, true)) this.drawWallOrDoor(x * cs, y * cs, (x + 1) * cs, y * cs, { type: 1 });
                }
            }
            for (let y = 0; y < this.height; y++) {
                for (let x = 0; x <= this.width; x++) {
                    const isActiveCol = (x < this.width && this.activeCells[y][x]) || (x > 0 && this.activeCells[y][x - 1]);
                    if (!isActiveCol) continue;
                    if (this.vWalls[y][x].type > 0) this.drawWallOrDoor(x * cs, y * cs, x * cs, (y + 1) * cs, this.vWalls[y][x]);
                    else if (this.editor.mode === 'free' && shouldDrawBoundary(x, y, false)) this.drawWallOrDoor(x * cs, y * cs, x * cs, (y + 1) * cs, { type: 1 });
                }
            }
            ctx.stroke();
            this.drawCorners(true); this.drawWallOverlays();
            if (this.editor.tool === EDITOR_TOOLS.GRID && this.editor.hoveredWall) {
                const { x, y } = this.editor.hoveredWall;
                if (x >= 0 && x < this.width && y >= 0 && y < this.height) { ctx.fillStyle = "rgba(255, 255, 0, 0.3)"; ctx.fillRect(x * cs, y * cs, cs, cs); }
            } else if (this.editor.hoveredWall && !this.editor.isDragging && this.editor.tool !== EDITOR_TOOLS.ERASER) {
                const { x, y, type, direction } = this.editor.hoveredWall;
                let wallType = 1;
                switch (this.editor.tool) {
                    case EDITOR_TOOLS.DOOR: wallType = 2; break; case EDITOR_TOOLS.GLASS: wallType = 5; break;
                    case EDITOR_TOOLS.LOCK: wallType = 3; break; case EDITOR_TOOLS.ONE_WAY: wallType = 4; break;
                    case EDITOR_TOOLS.LETTER_DOOR: wallType = 6; break; default: wallType = 1;
                }
                const isValidWall = (type === 'h') ? (y > 0 && this.activeCells[y - 1][x]) || (y < this.height && this.activeCells[y][x]) : (x > 0 && this.activeCells[y][x - 1]) || (x < this.width && this.activeCells[y][x]);
                if (isValidWall) {
                    ctx.beginPath(); const wallObject = { type: wallType, keys: '?', direction: direction };
                    if (type === 'h') this.drawWallOrDoor(x * cs, y * cs, (x + 1) * cs, y * cs, wallObject, true);
                    else this.drawWallOrDoor(x * cs, y * cs, x * cs, (y + 1) * cs, wallObject, true);
                    ctx.stroke();
                    if (wallObject.type === WALL_TYPES.ONE_WAY && wallObject.direction) {
                        if (type === 'h') { this.drawArrow(x * cs, y * cs, (x + 1) * cs, y * cs, direction, 'white', false); }
                        else { this.drawArrow(x * cs, y * cs, x * cs, (y + 1) * cs, direction, 'white', false); }
                    }
                }
            }
            this.stairs.filter(s => s.layer === this.currentLayer).forEach(s => this.drawStair(s));
            if (this.editor.tool === EDITOR_TOOLS.STAIR && this.editor.stairPlacement) { this.drawStair(this.editor.stairPlacement, !this.editor.isDragging); }
            this.items.forEach(item => this.drawItem(item));
            if (this.endPos) this.drawCircle(this.endPos.x, this.endPos.y, this.colors.endPoint);
            if (this.customStartPos) this.drawCircle(this.customStartPos.x, this.customStartPos.y, this.colors.player);
            this.ghosts.forEach(g => this.drawCircle(g.x, g.y, this.colors.ghost));
            this.buttons.forEach(b => this.drawButton(b));
            if (this.editor.mode === 'regular') this.drawCircle(this.startPos.x, this.startPos.y, this.colors.player);
            if (this.editor.hoveredButtonHotspot) {
                const virtualButton = { x: this.editor.hoveredButtonHotspot.x, y: this.editor.hoveredButtonHotspot.y, direction: this.editor.hoveredButtonHotspot.direction };
                this.drawButton(virtualButton, true);
            }
            ctx.restore();
        }

        getMousePos(e) {
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width; const scaleY = canvas.height / rect.height;
            const mx = (e.clientX - rect.left) * scaleX; const my = (e.clientY - rect.top) * scaleY;
            if (this.state === GAME_STATES.PLAYING) { return { x: mx - this.drawOffset.x, y: my - this.drawOffset.y }; }
            return { x: mx - (this.padding || 0), y: my - (this.padding || 0) };
        }

        isPosInStartRoom(cellX, cellY) {
            if (this.editor.mode === 'regular') {
                const roomY = this.height - 3;
                return cellX >= 0 && cellX < 3 && cellY >= roomY && cellY < roomY + 3;
            }
            return false;
        }

        isWallEditable(wall) {
            if (!wall) return false;
            if (this.editor.mode === 'free') {
                const { x, y, type } = wall;
                const up = (type === 'h' && y > 0) ? this.activeCells[y - 1][x] : false;
                const down = (type === 'h' && y < this.height) ? this.activeCells[y][x] : false;
                const left = (type === 'v' && x > 0) ? this.activeCells[y][x - 1] : false;
                const right = (type === 'v' && x < this.width) ? this.activeCells[y][x] : false;
                if (type === 'h') return up && down; if (type === 'v') return left && right;
                return false;
            }
            const { x, y, type } = wall;
            if (type === 'h' && (y === 0 || y === this.height)) return false;
            if (type === 'v' && (x === 0 || x === this.width)) return false;
            const roomY = this.height - 3;
            if (type === 'h' && y === roomY && x >= 0 && x < 3) return false;
            if (type === 'h' && y === roomY + 3 && x >= 0 && x < 3) return false;
            if (type === 'v' && x === 0 && y >= roomY && y < roomY + 3) return false;
            if (type === 'v' && x === 3 && y >= roomY && y < roomY + 3) return false;
            if (x >= 0 && x < 3 && y > roomY && y < roomY + 3 && type === 'h') return false;
            if (y >= roomY && y < roomY + 3 && x > 0 && x < 3 && type === 'v') return false;
            return true;
        }

        isCellOccupiedInEditor(x, y) {
            if (this.endPos && this.endPos.x === x && this.endPos.y === y) return true;
            if (this.customStartPos && this.customStartPos.x === x && this.customStartPos.y === y) return true;
            if (this.ghosts.some(g => g.x === x && g.y === y)) return true;
            if (this.items.some(i => i.x === x && i.y === y)) return true;
            return false;
        }

        eraseAtPos(pos) {
            const wall = this.getWallAtPos(pos.x, pos.y);
            if (wall && this.isWallEditable(wall)) {
                if (wall.type === 'h') this.hWalls[wall.y][wall.x] = { type: WALL_TYPES.EMPTY, keys: 0 };
                else this.vWalls[wall.y][wall.x] = { type: WALL_TYPES.EMPTY, keys: 0 };
            }
            const cellX = Math.floor(pos.x / this.cellSize); const cellY = Math.floor(pos.y / this.cellSize);
            if (this.editor.mode === 'free' || !this.isPosInStartRoom(cellX, cellY)) {
                if (this.endPos && this.endPos.x === cellX && this.endPos.y === cellY) { this.endPos = null; }
                if (this.customStartPos && this.customStartPos.x === cellX && this.customStartPos.y === cellY) { this.customStartPos = null; }
                this.ghosts = this.ghosts.filter(g => g.x !== cellX || g.y !== cellY);
                this.items = this.items.filter(i => i.x !== cellX || i.y !== cellY);
                this.eraseStairAt(cellX, cellY, this.currentLayer);
            }
            this.drawEditor();
        }

        eraseStairAt(x, y, layer) {
            const stair = this.stairs.find(s => s.x === x && s.y === y && s.layer === layer);
            if (!stair) return;
            const pairedLayer = stair.direction === 'up' ? layer + 1 : layer - 1;
            const pairedDirection = stair.direction === 'up' ? 'down' : 'up';
            this.stairs = this.stairs.filter(s => !(s.x === x && s.y === y && (s.layer === layer || (s.layer === pairedLayer && s.direction === pairedDirection))));
        }

        handleCanvasClick(e) {
            if (this.state !== GAME_STATES.PLAYING || this.editor.active) return;
            this.stopAutoMove();
            const pos = this.getMousePos(e);
            const targetX = Math.floor(pos.x / this.cellSize); const targetY = Math.floor(pos.y / this.cellSize);
            if (targetX < 0 || targetX >= this.width || targetY < 0 || targetY >= this.height) return;
            const dx = targetX - this.player.x; const dy = targetY - this.player.y;
            if (Math.abs(dx) + Math.abs(dy) === 1) { this.movePlayer(dx, dy); return; }
            if (!this.seenCells[targetY][targetX] && !this.debugVision) return;
            const path = this.findPlayerPath({ x: this.player.x, y: this.player.y }, { x: targetX, y: targetY });
            if (path && path.length > 1) {
                let currentStep = 1;
                const move = () => {
                    if (currentStep >= path.length || this.state !== GAME_STATES.PLAYING) { this.stopAutoMove(); return; }
                    const nextPos = path[currentStep];
                    this.movePlayer(nextPos.x - this.player.x, nextPos.y - this.player.y);
                    currentStep++;
                };
                move();
                if (path.length > 2) { this.autoMoveInterval = setInterval(move, 200); }
            }
        }

        stopAutoMove() {
            if (this.autoMoveInterval) { clearInterval(this.autoMoveInterval); this.autoMoveInterval = null; }
            if (this.dpadInterval) { clearInterval(this.dpadInterval); }
        }

        handleCanvasMouseDown(e) {
            if (!this.editor.active) return;
            this.editor.isDragging = true; this.editor.didDrag = false; this.editor.hoveredWall = null;
            const pos = this.getMousePos(e);
            if (this.editor.tool === EDITOR_TOOLS.GRID && this.editor.mode === 'free') {
                const cellX = Math.floor(pos.x / this.cellSize); const cellY = Math.floor(pos.y / this.cellSize);
                if (cellX >= 0 && cellX < this.width && cellY >= 0 && cellY < this.height) {
                    this.editor.gridDragAction = this.activeCells[cellY][cellX] ? 'remove' : 'add';
                    this.toggleActiveCell(cellX, cellY, this.editor.gridDragAction);
                }
            } else if (this.editor.tool === EDITOR_TOOLS.STAIR && this.multiLayerMode) {
                const cellX = Math.floor(pos.x / this.cellSize); const cellY = Math.floor(pos.y / this.cellSize);
                if (cellX >= 0 && cellX < this.width && cellY >= 0 && cellY < this.height) {
                    const existingStair = this.stairs.find(s => s.x === cellX && s.y === cellY && s.layer === this.currentLayer);
                    if (existingStair) { this.eraseStairAt(cellX, cellY, this.currentLayer); this.drawEditor(); }
                    else {
                        let direction = (pos.y - cellY * this.cellSize) < this.cellSize / 2 ? 'up' : 'down';
                        if (!this.isValidStairPlacement(cellX, cellY, direction)) {
                            const otherDirection = direction === 'up' ? 'down' : 'up';
                            if (this.isValidStairPlacement(cellX, cellY, otherDirection)) { direction = otherDirection; }
                        }
                        if (this.isValidStairPlacement(cellX, cellY, direction)) { this.editor.stairPlacement = { x: cellX, y: cellY, direction, layer: this.currentLayer }; }
                        else { this.showToast('无效放置', 1500, 'error'); }
                        this.drawEditor();
                    }
                }
            } else if (this.editor.tool === EDITOR_TOOLS.WALL || this.editor.tool === EDITOR_TOOLS.GLASS) {
                const wall = this.getWallAtPos(pos.x, pos.y);
                if (wall && this.isWallEditable(wall)) {
                    this.editor.dragAxis = wall.type;
                    const type = this.editor.tool === EDITOR_TOOLS.GLASS ? WALL_TYPES.GLASS : WALL_TYPES.SOLID;
                    this.toggleWall(wall, type); this.editor.lastDragPos = wall;
                } else { this.editor.dragAxis = null; }
            } else if (this.editor.tool === EDITOR_TOOLS.ERASER) { this.eraseAtPos(pos); }
            else if (this.editor.tool === EDITOR_TOOLS.ONE_WAY) {
                const wall = this.getWallAtPos(pos.x, pos.y);
                if (wall && this.isWallEditable(wall)) {
                    const direction = this.getMouseSideOfWall(pos.x, pos.y, wall);
                    const newWall = { type: WALL_TYPES.ONE_WAY, direction: direction };
                    if (wall.type === 'h') this.hWalls[wall.y][wall.x] = newWall; else this.vWalls[wall.y][wall.x] = newWall;
                    this.editor.lastDragPos = wall; this.drawEditor();
                }
            }
        }

        handleCanvasMouseMove(e) {
            if (!this.editor.active) return;
            const pos = this.getMousePos(e);
            if (this.editor.tool === EDITOR_TOOLS.GRID && this.editor.mode === 'free') {
                const cellX = Math.floor(pos.x / this.cellSize); const cellY = Math.floor(pos.y / this.cellSize);
                if (this.editor.isDragging) {
                    this.editor.hoveredWall = null; this.editor.didDrag = true;
                    if (cellX >= 0 && cellX < this.width && cellY >= 0 && cellY < this.height) {
                        const currentStatus = this.activeCells[cellY][cellX];
                        if ((this.editor.gridDragAction === 'add' && !currentStatus) || (this.editor.gridDragAction === 'remove' && currentStatus)) {
                            this.toggleActiveCell(cellX, cellY, this.editor.gridDragAction);
                        }
                    }
                } else {
                    if (!this.editor.hoveredWall || this.editor.hoveredWall.x !== cellX || this.editor.hoveredWall.y !== cellY) {
                        this.editor.hoveredWall = { x: cellX, y: cellY }; this.drawEditor();
                    }
                }
                return;
            }
            if (this.editor.tool === EDITOR_TOOLS.STAIR && this.multiLayerMode) {
                if (this.editor.stairPlacement && this.editor.isDragging) {
                    const cellX = this.editor.stairPlacement.x; const cellY = this.editor.stairPlacement.y;
                    let direction = (pos.y - cellY * this.cellSize) < this.cellSize / 2 ? 'up' : 'down';
                    if (!this.isValidStairPlacement(cellX, cellY, direction)) {
                        const otherDirection = direction === 'up' ? 'down' : 'up';
                        if (this.isValidStairPlacement(cellX, cellY, otherDirection)) { direction = otherDirection; }
                    }
                    if (this.editor.stairPlacement.direction !== direction) {
                        this.editor.stairPlacement.direction = direction; this.editor.didDrag = true; this.drawEditor();
                    }
                } else if (!this.editor.isDragging) {
                    const cellX = Math.floor(pos.x / this.cellSize); const cellY = Math.floor(pos.y / this.cellSize);
                    if (cellX >= 0 && cellX < this.width && cellY >= 0 && cellY < this.height && this.activeCells[cellY][cellX]) {
                        const existingStair = this.stairs.find(s => s.x === cellX && s.y === cellY && s.layer === this.currentLayer);
                        if (!existingStair) {
                            let direction = (pos.y - cellY * this.cellSize) < this.cellSize / 2 ? 'up' : 'down';
                            let valid = this.isValidStairPlacement(cellX, cellY, direction);
                            if (!valid) {
                                const otherDirection = direction === 'up' ? 'down' : 'up';
                                if (this.isValidStairPlacement(cellX, cellY, otherDirection)) { direction = otherDirection; valid = true; }
                            }
                            if (valid) {
                                const newPlacement = { x: cellX, y: cellY, direction, layer: this.currentLayer };
                                if (!this.editor.stairPlacement || this.editor.stairPlacement.x !== newPlacement.x || this.editor.stairPlacement.y !== newPlacement.y || this.editor.stairPlacement.direction !== newPlacement.direction) {
                                    this.editor.stairPlacement = newPlacement; this.drawEditor();
                                }
                            } else if (this.editor.stairPlacement) { this.editor.stairPlacement = null; this.drawEditor(); }
                        } else if (this.editor.stairPlacement) { this.editor.stairPlacement = null; this.drawEditor(); }
                    } else if (this.editor.stairPlacement) { this.editor.stairPlacement = null; this.drawEditor(); }
                }
                return;
            }
            const isWallTool = [EDITOR_TOOLS.WALL, EDITOR_TOOLS.DOOR, EDITOR_TOOLS.LOCK, EDITOR_TOOLS.ONE_WAY, EDITOR_TOOLS.GLASS, EDITOR_TOOLS.LETTER_DOOR].includes(this.editor.tool);
            if (!this.editor.isDragging) {
                let needsRedraw = false;
                if (isWallTool) {
                    const wall = this.getWallAtPos(pos.x, pos.y);
                    if (this.editor.hoveredButtonHotspot) { this.editor.hoveredButtonHotspot = null; needsRedraw = true; }
                    if (wall && this.isWallEditable(wall)) {
                        if (!this.editor.hoveredWall || this.editor.hoveredWall.x !== wall.x || this.editor.hoveredWall.y !== wall.y || this.editor.hoveredWall.type !== wall.type) {
                            this.editor.hoveredWall = wall; needsRedraw = true;
                        }
                        if (this.editor.tool === EDITOR_TOOLS.ONE_WAY) {
                            const direction = this.getMouseSideOfWall(pos.x, pos.y, wall);
                            if (!this.editor.hoveredWall.direction || this.editor.hoveredWall.direction.dx !== direction.dx || this.editor.hoveredWall.direction.dy !== direction.dy) {
                                this.editor.hoveredWall.direction = direction; needsRedraw = true;
                            }
                        }
                    } else if (this.editor.hoveredWall) { this.editor.hoveredWall = null; needsRedraw = true; }
                } else if (this.editor.tool === EDITOR_TOOLS.BUTTON) {
                    const hotspot = this.getButtonHotspotAtPos(pos.x, pos.y);
                    if (this.editor.hoveredWall) { this.editor.hoveredWall = null; needsRedraw = true; }
                    if (hotspot?.x !== this.editor.hoveredButtonHotspot?.x || hotspot?.y !== this.editor.hoveredButtonHotspot?.y || hotspot?.direction.dx !== this.editor.hoveredButtonHotspot?.direction.dx) {
                        this.editor.hoveredButtonHotspot = hotspot; needsRedraw = true;
                    }
                } else {
                    if (this.editor.hoveredWall) { this.editor.hoveredWall = null; needsRedraw = true; }
                    if (this.editor.hoveredButtonHotspot) { this.editor.hoveredButtonHotspot = null; needsRedraw = true; }
                }
                if (needsRedraw) { this.drawEditor(); }
                return;
            }
            this.editor.didDrag = true; this.editor.hoveredWall = null;
            if ((this.editor.tool === EDITOR_TOOLS.WALL || this.editor.tool === EDITOR_TOOLS.GLASS) && this.editor.dragAxis) {
                let wall;
                if (this.editor.dragAxis === 'h') { wall = { type: 'h', x: Math.floor(pos.x / this.cellSize), y: this.editor.lastDragPos.y }; }
                else { wall = { type: 'v', x: this.editor.lastDragPos.x, y: Math.floor(pos.y / this.cellSize) }; }
                if (wall && this.isWallEditable(wall) && (wall.x !== this.editor.lastDragPos.x || wall.y !== this.editor.lastDragPos.y)) {
                    const newType = this.editor.tool === EDITOR_TOOLS.GLASS ? WALL_TYPES.GLASS : WALL_TYPES.SOLID;
                    if (wall.type === 'h') this.hWalls[wall.y][wall.x] = { type: newType }; else this.vWalls[wall.y][wall.x] = { type: newType };
                    this.drawEditor(); this.editor.lastDragPos = wall;
                }
            } else if (this.editor.tool === EDITOR_TOOLS.ERASER) { this.eraseAtPos(pos); }
            else if (this.editor.tool === EDITOR_TOOLS.ONE_WAY && this.editor.lastDragPos) {
                const wallData = this.editor.lastDragPos;
                const newDirection = this.getMouseSideOfWall(pos.x, pos.y, wallData);
                let currentWall = (wallData.type === 'h') ? this.hWalls[wallData.y][wallData.x] : this.vWalls[wallData.y][wallData.x];
                if (currentWall && currentWall.type === WALL_TYPES.ONE_WAY && (currentWall.direction.dx !== newDirection.dx || currentWall.direction.dy !== newDirection.dy)) {
                    currentWall.direction = newDirection; this.drawEditor();
                }
            }
        }

        toggleActiveCell(x, y, action) {
            if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
            const newState = (action === 'add');
            if (this.activeCells[y][x] === newState) return;
            this.activeCells[y][x] = newState;
            if (!newState) {
                if (this.customStartPos && this.customStartPos.x === x && this.customStartPos.y === y) this.customStartPos = null;
                if (this.endPos && this.endPos.x === x && this.endPos.y === y) this.endPos = null;
                this.ghosts = this.ghosts.filter(g => g.x !== x || g.y !== y);
                this.items = this.items.filter(i => i.x !== x || i.y !== y);
                this.buttons = this.buttons.filter(b => b.x !== x || b.y !== y);
                this.eraseStairAt(x, y, this.currentLayer);
                this.hWalls[y][x] = { type: 0 }; this.hWalls[y + 1][x] = { type: 0 };
                this.vWalls[y][x] = { type: 0 }; this.vWalls[y][x + 1] = { type: 0 };
            }
            this._renderStaticLayer(); this.drawEditor();
        }

        isValidStairPlacement(x, y, direction) {
            if (!this.activeCells[y][x]) return false;
            const targetLayer = direction === 'up' ? this.currentLayer + 1 : this.currentLayer - 1;
            if (targetLayer < 0 || targetLayer >= this.layerCount) return false;
            if (this.layers[targetLayer] && this.layers[targetLayer].activeCells && !this.layers[targetLayer].activeCells[y][x]) return false;
            return true;
        }

        placeStair(x, y, direction) {
            if (!this.isValidStairPlacement(x, y, direction)) { this.showToast('无效放置', 2000, 'error'); return false; }
            const targetLayer = direction === 'up' ? this.currentLayer + 1 : this.currentLayer - 1;
            const pairedDirection = direction === 'up' ? 'down' : 'up';
            this.stairs.push({ x, y, direction, layer: this.currentLayer });
            this.stairs.push({ x, y, direction: pairedDirection, layer: targetLayer });
            return true;
        }

        handleCanvasMouseUp(e) {
            if (!this.editor.active) return;
            this.editor.gridDragAction = null;
            if (this.editor.tool === EDITOR_TOOLS.STAIR && this.editor.stairPlacement) {
                const { x, y, direction } = this.editor.stairPlacement;
                this.placeStair(x, y, direction);
                this.editor.stairPlacement = null; this.drawEditor();
                this.editor.isDragging = false; this.editor.didDrag = false; return;
            }
            if (this.editor.isDragging && !this.editor.didDrag) {
                const pos = this.getMousePos(e);
                const cx = Math.floor(pos.x / this.cellSize); const cy = Math.floor(pos.y / this.cellSize);
                const wall = this.getWallAtPos(pos.x, pos.y);
                if (wall && this.isWallEditable(wall)) {
                    if (this.editor.tool === EDITOR_TOOLS.DOOR) {
                        const wallRef = wall.type === 'h' ? this.hWalls[wall.y][wall.x] : this.vWalls[wall.y][wall.x];
                        wallRef.type = wallRef.type === WALL_TYPES.DOOR ? WALL_TYPES.EMPTY : WALL_TYPES.DOOR;
                    } else if (this.editor.tool === EDITOR_TOOLS.LOCK) {
                        const numStr = prompt('请输入锁需要的钥匙数量:', '0');
                        if (numStr !== null) {
                            const keys = parseInt(numStr);
                            if (!isNaN(keys) && keys >= 0) {
                                const newWall = { type: WALL_TYPES.LOCKED, keys: keys };
                                if (wall.type === 'h') this.hWalls[wall.y][wall.x] = newWall; else this.vWalls[wall.y][wall.x] = newWall;
                            } else { this.showToast('请输入一个有效的非负整数。', 3000, 'error'); }
                        }
                    } else if (this.editor.tool === EDITOR_TOOLS.LETTER_DOOR) {
                        const wallRef = wall.type === 'h' ? this.hWalls[wall.y][wall.x] : this.vWalls[wall.y][wall.x];
                        if (wallRef.type === WALL_TYPES.LETTER_DOOR) { wallRef.initialState = (wallRef.initialState === 'open') ? 'closed' : 'open'; }
                        else {
                            const letter = prompt('请输入一个字母:', 'A');
                            if (letter && /^[a-zA-Z]$/.test(letter)) {
                                const newWall = { type: WALL_TYPES.LETTER_DOOR, letter: letter.toUpperCase(), initialState: 'closed' };
                                if (wall.type === 'h') this.hWalls[wall.y][wall.x] = newWall; else this.vWalls[wall.y][wall.x] = newWall;
                            } else if (letter !== null) { this.showToast('请输入单个英文字母。', 3000, 'error'); }
                        }
                    }
                }
                if (this.editor.tool === EDITOR_TOOLS.BUTTON) {
                    const hotspot = this.getButtonHotspotAtPos(pos.x, pos.y);
                    if (hotspot && this.activeCells[hotspot.y][hotspot.x]) {
                        const existingButtonIndex = this.buttons.findIndex(b => b.x === hotspot.x && b.y === hotspot.y && b.direction.dx === hotspot.direction.dx && b.direction.dy === hotspot.direction.dy);
                        if (existingButtonIndex > -1) { this.buttons.splice(existingButtonIndex, 1); }
                        else {
                            const letter = prompt('请输入一个字母:', 'A');
                            if (letter && /^[a-zA-Z]$/.test(letter)) { this.buttons.push({ ...hotspot, letter: letter.toUpperCase() }); }
                            else if (letter !== null) { this.showToast('请输入单个英文字母。', 3000, 'error'); }
                        }
                    }
                }
                if (cx >= 0 && cx < this.width && cy >= 0 && cy < this.height && this.activeCells[cy][cx]) {
                    const allowed = this.editor.mode === 'free' ? true : !this.isPosInStartRoom(cx, cy);
                    if (allowed) {
                        const isOccupied = this.isCellOccupiedInEditor(cx, cy);
                        switch (this.editor.tool) {
                            case EDITOR_TOOLS.END: if (!isOccupied || (this.endPos && this.endPos.x === cx && this.endPos.y === cy)) { this.endPos = { x: cx, y: cy }; } break;
                            case EDITOR_TOOLS.START:
                                if (this.editor.mode === 'free' && (!isOccupied || (this.customStartPos && this.customStartPos.x === cx && this.customStartPos.y === cy))) {
                                    if (this.multiLayerMode) {
                                        this._saveCurrentLayerData();
                                        for (let i = 0; i < this.layerCount; i++) { if (this.layers[i]) { this.layers[i].customStartPos = null; } }
                                    }
                                    this.customStartPos = { x: cx, y: cy }; this.playerLayer = this.currentLayer; this.updateLayerPanel();
                                } break;
                            case EDITOR_TOOLS.GHOST:
                                const existingGhostIndex = this.ghosts.findIndex(g => g.x === cx && g.y === cy);
                                if (existingGhostIndex > -1) this.ghosts.splice(existingGhostIndex, 1); else if (!isOccupied) this.ghosts.push({ x: cx, y: cy });
                                break;
                            case EDITOR_TOOLS.KEY:
                                const existingItemIndex = this.items.findIndex(i => i.x === cx && i.y === cy);
                                if (existingItemIndex > -1 && this.items[existingItemIndex].type === 'key') this.items.splice(existingItemIndex, 1); else if (!isOccupied) this.items.push({ x: cx, y: cy, type: 'key' });
                                break;
                        }
                    }
                }
                this.drawEditor();
            }
            this.editor.isDragging = false; this.editor.didDrag = false;
            this.editor.dragAxis = null; this.editor.lastDragPos = null;
        }

        handleCanvasMouseLeave(e) {
            if (this.editor.hoveredWall) { this.editor.hoveredWall = null; this.drawEditor(); }
            this.editor.dragAxis = null; this.editor.lastDragPos = null;
        }

        getWallAtPos(mouseX, mouseY) {
            const cs = this.cellSize; const tolerance = cs / 5;
            const gridX = mouseX / cs; const gridY = mouseY / cs;
            const x = Math.floor(gridX); const y = Math.floor(gridY);
            const nearHorizontal = Math.abs(gridY - Math.round(gridY)) * cs < tolerance;
            const nearVertical = Math.abs(gridX - Math.round(gridX)) * cs < tolerance;
            if (nearHorizontal && !nearVertical) return { type: 'h', x: x, y: Math.round(gridY) };
            if (nearVertical && !nearHorizontal) return { type: 'v', x: Math.round(gridX), y: y };
            return null;
        }

        getButtonHotspotAtPos(mouseX, mouseY) {
            const cs = this.cellSize; let cellX = Math.floor(mouseX / cs); let cellY = Math.floor(mouseY / cs);
            const isValidCell = (cx, cy) => cx >= 0 && cx < this.width && cy >= 0 && cy < this.height;
            if (!isValidCell(cellX, cellY)) {
                const localX = mouseX - cellX * cs; const localY = mouseY - cellY * cs; const tolerance = cs * 0.3;
                if (localX > cs - tolerance && isValidCell(cellX + 1, cellY)) cellX++;
                else if (localX < tolerance && isValidCell(cellX - 1, cellY)) cellX--;
                else if (localY > cs - tolerance && isValidCell(cellX, cellY + 1)) cellY++;
                else if (localY < tolerance && isValidCell(cellX, cellY - 1)) cellY--;
                else return null;
            }
            if (!isValidCell(cellX, cellY) || !this.activeCells[cellY][cellX]) return null;
            const localX = mouseX - cellX * cs; const localY = mouseY - cellY * cs;
            let direction = null;
            if (localY < localX && localY < -localX + cs) direction = { dx: 0, dy: -1 };
            else if (localY > localX && localY > -localX + cs) direction = { dx: 0, dy: 1 };
            else if (localY > localX && localY < -localX + cs) direction = { dx: -1, dy: 0 };
            else if (localY < localX && localY > -localX + cs) direction = { dx: 1, dy: 0 };
            if (!direction) return null;
            const isActive = (x, y) => (x >= 0 && x < this.width && y >= 0 && y < this.height) ? this.activeCells[y][x] : false;
            let isAttachable = false;
            if (direction.dy === -1) { if (this.hWalls[cellY][cellX].type === WALL_TYPES.SOLID || (isActive(cellX, cellY) && !isActive(cellX, cellY - 1))) isAttachable = true; }
            else if (direction.dy === 1) { if (this.hWalls[cellY + 1][cellX].type === WALL_TYPES.SOLID || (isActive(cellX, cellY) && !isActive(cellX, cellY + 1))) isAttachable = true; }
            else if (direction.dx === -1) { if (this.vWalls[cellY][cellX].type === WALL_TYPES.SOLID || (isActive(cellX, cellY) && !isActive(cellX - 1, cellY))) isAttachable = true; }
            else if (direction.dx === 1) { if (this.vWalls[cellY][cellX + 1].type === WALL_TYPES.SOLID || (isActive(cellX, cellY) && !isActive(cellX + 1, cellY))) isAttachable = true; }
            if (isAttachable) {
                const roomYStart = this.height - 3;
                const isTopBoundary = direction.dy === -1 && cellY === roomYStart && cellX >= 0 && cellX < 3;
                const isRightBoundary = direction.dx === 1 && cellX === 2 && cellY >= roomYStart && cellY < this.height;
                if (this.editor.mode === 'regular' && (isTopBoundary || isRightBoundary)) { return null; }
                return { x: cellX, y: cellY, direction: direction };
            }
            return null;
        }

        toggleWall(wall, targetType = WALL_TYPES.SOLID) {
            const { x, y, type } = wall;
            if (type === 'h' && y >= 0 && y <= this.height && x >= 0 && x < this.width) {
                this.hWalls[y][x].type = this.hWalls[y][x].type === targetType ? WALL_TYPES.EMPTY : targetType;
            } else if (type === 'v' && x >= 0 && x <= this.width && y >= 0 && y < this.height) {
                this.vWalls[y][x].type = this.vWalls[y][x].type === targetType ? WALL_TYPES.EMPTY : targetType;
            }
            this.drawEditor();
        }

        getMouseSideOfWall(mouseX, mouseY, wall) {
            const cs = this.cellSize;
            if (wall.type === 'h') { return (mouseY > wall.y * cs) ? { dx: 0, dy: 1 } : { dx: 0, dy: -1 }; }
            else { return (mouseX > wall.x * cs) ? { dx: 1, dy: 0 } : { dx: -1, dy: 0 }; }
        }

        calculateDistances(startNode) {
            const distances = Array(this.height).fill(null).map(() => Array(this.width).fill(Infinity));
            const queue = [{ x: startNode.x, y: startNode.y, dist: 0 }];
            distances[startNode.y][startNode.x] = 0;
            while (queue.length > 0) {
                const { x, y, dist } = queue.shift();
                const neighbors = [{ dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }];
                for (const { dx, dy } of neighbors) {
                    const nx = x + dx; const ny = y + dy;
                    if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
                        let wall;
                        if (dx === 1) wall = this.vWalls[y][x + 1]; if (dx === -1) wall = this.vWalls[y][x];
                        if (dy === 1) wall = this.hWalls[y + 1][x]; if (dy === -1) wall = this.hWalls[y][x];
                        if (wall && [WALL_TYPES.SOLID, WALL_TYPES.LOCKED, WALL_TYPES.ONE_WAY].includes(wall.type)) continue;
                        if (distances[ny][nx] === Infinity) { distances[ny][nx] = dist + 1; queue.push({ x: nx, y: ny, dist: dist + 1 }); }
                    }
                }
            }
            return distances;
        }

        findPlayerPath(start, end) {
            const queue = [[{ x: start.x, y: start.y }]];
            const visited = new Set([`${start.x},${start.y}`]);
            while (queue.length > 0) {
                const path = queue.shift(); const { x, y } = path[path.length - 1];
                if (x === end.x && y === end.y) return path;
                const neighbors = [{ dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }];
                for (const { dx, dy } of neighbors) {
                    const nx = x + dx; const ny = y + dy; const key = `${nx},${ny}`;
                    if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height && !visited.has(key)) {
                        if (!this.seenCells[ny][nx] && !this.debugVision) continue;
                        let wall, isBlocked = false;
                        if (dx === 1) wall = this.vWalls[y][x + 1]; else if (dx === -1) wall = this.vWalls[y][x];
                        else if (dy === 1) wall = this.hWalls[y + 1][x]; else if (dy === -1) wall = this.hWalls[y][x];
                        if (wall) {
                            if (wall.type === WALL_TYPES.SOLID || wall.type === WALL_TYPES.GLASS || (wall.type === WALL_TYPES.LOCKED && this.player.keys < wall.keys)) { isBlocked = true; }
                            else if (wall.type === WALL_TYPES.ONE_WAY && (dx !== wall.direction.dx || dy !== wall.direction.dy)) { isBlocked = true; }
                        }
                        if (isBlocked) continue;
                        visited.add(key); const newPath = [...path, { x: nx, y: ny }]; queue.push(newPath);
                    }
                }
            }
            return null;
        }

        async _loadCodeFromClipboard(isEditor = false) {
            try {
                const code = await navigator.clipboard.readText();
                if (code) { this.loadFromShareCode(code, isEditor); }
                else { this.showToast('剪贴板为空。', 3000, 'error'); }
            } catch (err) {
                console.error('无法读取剪贴板内容: ', err);
                this.showToast('无法读取剪贴板。请检查浏览器权限。', 3000, 'error');
            }
        }

        generateShareCode(isEditor = false) {
            let sourceData;
            if (isEditor) {
                if (this.multiLayerMode) { this._saveCurrentLayerData(); }
                let layer0Data = {
                    hWalls: this.hWalls, vWalls: this.vWalls, endPos: this.endPos, ghosts: this.ghosts, items: this.items,
                    buttons: this.buttons || [], activeCells: this.activeCells, customStartPos: this.customStartPos
                };
                if (this.multiLayerMode && this.layers && this.layers[0]) { layer0Data = this.layers[0]; }
                sourceData = {
                    width: this.width, height: this.height, hWalls: layer0Data.hWalls, vWalls: layer0Data.vWalls,
                    endPos: layer0Data.endPos, initialGhosts: layer0Data.ghosts, items: layer0Data.items, buttons: layer0Data.buttons,
                    gameMode: this.gameMode, initialHealth: parseInt(document.getElementById('editor-initial-health').value) || 5,
                    initialStamina: parseInt(document.getElementById('editor-initial-stamina').value) || 100,
                    activeCells: layer0Data.activeCells, editorMode: this.editor.mode, customStartPos: layer0Data.customStartPos,
                    startPos: this.startPos, playerStartLayer: this.playerLayer, multiLayerMode: this.multiLayerMode,
                    layerCount: this.layerCount, layers: this.layers, stairs: this.stairs
                };
            } else {
                if (!this.mapData) return { success: false, error: '没有地图数据' };
                sourceData = {
                    ...this.mapData, gameMode: this.gameMode, initialHealth: this.initialHealth, initialStamina: this.initialStamina,
                    playerStartLayer: typeof this.mapData.playerStartLayer === 'number' ? this.mapData.playerStartLayer : (this.playerLayer || 0)
                };
            }
            return DataSerializer.generateShareCode(sourceData);
        }

        loadFromShareCode(code, isEditor = false) {
            const result = DataSerializer.loadFromShareCode(code);
            if (result.success) {
                this._applyLoadedData(result.data.mapData, result.data.gameMode, result.data.initialHealth, result.data.initialStamina, isEditor);
            } else {
                this.showToast(result.error, 3000, 'error');
            }
        }

        _applyLoadedData(mapData, gameMode, health, stamina, isEditor) {
            if (isEditor) {
                this.setGameMode(gameMode, true);
                document.getElementById('editor-initial-health').value = health;
                document.getElementById('editor-initial-stamina').value = stamina;
                this.width = mapData.width; this.height = mapData.height;
                this.startPos = { x: 1, y: this.height - 2 }; this.editorMapSizeInput.value = this.width;
                this.padding = 15; this.cellSize = (canvas.width - 2 * this.padding) / this.width;
                this.hWalls = mapData.hWalls; this.vWalls = mapData.vWalls; this.endPos = mapData.endPos;
                this.ghosts = mapData.initialGhosts; this.items = mapData.items; this.buttons = mapData.buttons || [];
                this.activeCells = mapData.activeCells || Array(this.height).fill(null).map(() => Array(this.width).fill(true));
                this.editor.mode = mapData.editorMode || 'regular'; this.customStartPos = mapData.customStartPos;
                this.multiLayerMode = mapData.multiLayerMode || false; this.layerCount = mapData.layerCount || 1;
                this.currentLayer = 0; this.stairs = JSON.parse(JSON.stringify(mapData.stairs || []));
                this.layers = JSON.parse(JSON.stringify(mapData.layers || []));
                this.playerLayer = typeof mapData.playerStartLayer === 'number' ? mapData.playerStartLayer : 0;
                if (this.multiLayerMode) {
                    if (this.playerLayer < 0 || this.playerLayer >= this.layerCount) this.playerLayer = 0;
                    this.currentLayer = this.playerLayer;
                    if (this.layers[this.playerLayer]) {
                        const layer = this.layers[this.playerLayer];
                        this.hWalls = layer.hWalls; this.vWalls = layer.vWalls; this.activeCells = layer.activeCells;
                        this.ghosts = layer.ghosts; this.items = layer.items; this.buttons = layer.buttons;
                        this.endPos = layer.endPos; this.customStartPos = layer.customStartPos || mapData.mapStartPos || null;
                    }
                }
                this.mapData = {
                    ...mapData, hWalls: JSON.parse(JSON.stringify(this.hWalls)), vWalls: JSON.parse(JSON.stringify(this.vWalls)),
                    initialGhosts: JSON.parse(JSON.stringify(this.ghosts)), items: JSON.parse(JSON.stringify(this.items)),
                    buttons: JSON.parse(JSON.stringify(this.buttons)), endPos: this.endPos, customStartPos: this.customStartPos,
                    activeCells: JSON.parse(JSON.stringify(this.activeCells))
                };
                this.updateEditorUIForMode(); this.updateLayerModeUI(); this.updateLayerPanel();
                this._renderStaticLayer(); this.drawEditor();
            } else {
                this.initialHealth = health; this.initialStamina = stamina;
                this.setGameMode(gameMode); this.startGame(mapData);
            }
            this.showToast('地图加载成功！', 2000, 'success');
        }

        updateHistoryButtons() {
            const undoBtn = document.getElementById('undo-btn');
            const saveBtn = document.getElementById('save-btn');
            const rewindBtn = document.getElementById('rewind-btn');
            const canUndo = this.currentStep > 0 && !this.history[this.currentStep].isRevivalPoint;
            undoBtn.disabled = !canUndo;
            const lastCheckpoint = this.checkpoints.length > 0 ? this.checkpoints[this.checkpoints.length - 1] : -1;
            saveBtn.disabled = !(this.currentStep > lastCheckpoint);
            rewindBtn.disabled = !this.checkpoints.some(cp => cp < this.currentStep);
        }

        handleUndo() {
            if (this.currentStep <= 0) return;
            if (this.history[this.currentStep] && this.history[this.currentStep].isRevivalPoint && this.currentStep > 0) {
                this.showToast('无法撤回到复活点之前', 2000, 'error'); return;
            }
            this.currentStep--; this.currentGameState = this.history[this.currentStep];
            this.viewLayer = this.currentGameState.player.layer; this.currentLayer = this.viewLayer;
            this._syncFromGameState(); this._renderStaticLayer(); this.draw();
            this.updateUIDisplays(); this.updateLayerPanel(); this.updateHistoryButtons();
        }

        handleSave() {
            const lastCheckpoint = this.checkpoints.length > 0 ? this.checkpoints[this.checkpoints.length - 1] : -1;
            if (this.currentStep <= lastCheckpoint) { this.showToast('请先移动后再存档', 2000, 'error'); return; }
            this.checkpoints.push(this.currentStep);
            this.showToast(`已在第 ${this.currentStep} 步创建存档`, 2000, 'success');
            this.updateHistoryButtons();
        }

        handleRewind() {
            const availableCheckpoints = this.checkpoints.filter(cp => cp < this.currentStep);
            if (availableCheckpoints.length === 0) { this.showToast('没有更早的存档点可供回溯', 2000, 'error'); return; }
            const targetStep = Math.max(...availableCheckpoints);
            this.currentStep = targetStep; this.currentGameState = this.history[this.currentStep];
            this.viewLayer = this.currentGameState.player.layer; this.currentLayer = this.viewLayer;
            this._syncFromGameState(); this._renderStaticLayer(); this.draw();
            this.updateUIDisplays(); this.updateLayerPanel(); this.updateHistoryButtons();
            this.showToast(`已回溯至存档点 (第 ${targetStep} 步)`, 2000, 'success');
        }

        copyShareCode(isEditor = false) {
            const result = this.generateShareCode(isEditor);
            if (result.success) {
                const code = result.code;
                navigator.clipboard.writeText(code).then(() => {
                    this.showToast('分享码已复制到剪贴板！', 2000, 'success');
                    this.updateURLWithShareCode(code);
                }).catch(err => {
                    console.error('复制分享码失败: ', err);
                    this.showToast('复制分享码失败。', 3000, 'error');
                });
            } else {
                this.showToast(result.error || '无法生成分享码。', 3000, 'error');
            }
        }
    }

    // 创建游戏实例并挂载到 window，以便主题切换器可以访问
    window.game = new GhostMazeGame();
});
