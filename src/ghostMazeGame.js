import { WALL_TYPES, GAME_STATES, EDITOR_TOOLS } from './constants.js';
import { MapDefinition } from './mapDefinition.js';
import { DataSerializer } from './dataSerializer.js';
import { GameLogic } from './gameLogic.js';

// 导入新的模块化组件
import * as UI from './ui.js';
import * as Renderer from './renderer.js';
import * as MazeGenerator from './mazeGenerator.js';
import * as InputHandler from './inputHandler.js';
import * as Editor from './editor.js';
import * as LayerManager from './layerManager.js';
import * as Pathfinding from './pathfinding.js';
import * as ThemeManager from './themeManager.js';

// 监听DOM内容加载完成事件，确保在操作DOM之前所有元素都已准备好
document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');
    
    // 初始化主题管理器
    ThemeManager.initThemeManager(() => {
        if (typeof game !== 'undefined' && game) {
            game.refreshTheme();
        }
    });

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
                stairPlacement: null, // 楼梯放置状态 {x, y, direction: 'up'|'down'}
                isRightClickErasing: false, // 右键橡皮擦状态
                rightClickMousePos: null // 右键擦除时的鼠标位置
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
            this.showInitialMessage();
            // 页面加载时尝试从 URL 查询参数或 hash 读取分享码
            this.loadShareCodeFromURL();
        }

        updateColors() {
            this.colors = ThemeManager.getColorsFromCSS();
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
            Renderer.showInitialMessage(ctx, {
                canvasWidth: canvas.width,
                canvasHeight: canvas.height,
                padding: this.padding,
                colors: this.colors
            });
        }

        /**
         * 显示一个短暂的顶部通知 (Toast)
         */
        showToast(message, duration = 3000, type = 'info') {
            UI.showToast(this.toastElement, message, duration, type, this);
        }

        /**
         * 显示一个确认对话框
         */
        showConfirm(message, onConfirm) {
            UI.showConfirm(this.confirmOverlay, this.confirmMessage, this.confirmYesBtn, this.confirmNoBtn, message, onConfirm);
        }

        /**
         * 隐藏所有游戏状态浮窗
         */
        hideAllOverlays() {
            UI.hideAllOverlays();
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
            // 编辑器模式的首页按钮
            document.getElementById('editor-home-btn').addEventListener('click', () => { window.location.href = window.location.pathname; });
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
                btn.addEventListener('click', (e) => {
                    // 获取按钮的id，找到tool-后面的部分
                    const toolName = e.currentTarget.id.split('-')[1];
                    this.setEditorTool(toolName);
                });
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
            // 右键相关事件处理（用于编辑器模式的橡皮擦功能）
            canvas.addEventListener('contextmenu', (e) => { if (this.editor.active) e.preventDefault(); });
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
            UI.initializeDpadTouchControls(this.dpad);
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
            UI.updateDpadVisibility(this.editor.active);
        }

        bindDpadControls() {
            InputHandler.bindDpadControls(this);
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
            // 使用 MazeGenerator 模块生成完整地图
            const mapData = MazeGenerator.generateFullMaze(size, size, this.ghostCount);
            this.startGame(mapData);
        }

        handleKeyPress(e) {
            // 编辑器模式的快捷键处理
            if (this.state === GAME_STATES.EDITOR && this.editor.active) {
                this.handleEditorKeyPress(e);
                return;
            }
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

        handleEditorKeyPress(e) {
            // 获取所有可见的工具按钮
            const getVisibleTools = () => {
                const toolBtns = document.querySelectorAll('.tool-btn');
                const visibleTools = [];
                toolBtns.forEach(btn => {
                    if (btn.style.display !== 'none') {
                        const toolName = btn.id.split('-')[1];
                        visibleTools.push(toolName);
                    }
                });
                return visibleTools;
            };

            switch (e.key) {
                case 'ArrowUp':
                case 'w':
                case 'W':
                    // 向上切换图层
                    if (this.multiLayerMode) {
                        e.preventDefault();
                        const nextLayer = this.currentLayer >= this.layerCount - 1 ? 0 : this.currentLayer + 1;
                        this.switchToLayer(nextLayer);
                    }
                    break;
                case 'ArrowDown':
                case 's':
                case 'S':
                    // 向下切换图层
                    if (this.multiLayerMode) {
                        e.preventDefault();
                        const prevLayer = this.currentLayer <= 0 ? this.layerCount - 1 : this.currentLayer - 1;
                        this.switchToLayer(prevLayer);
                    }
                    break;
                case 'ArrowLeft':
                case 'a':
                case 'A':
                    // 向左切换工具
                    e.preventDefault();
                    {
                        const visibleTools = getVisibleTools();
                        const currentIndex = visibleTools.indexOf(this.editor.tool);
                        const nextIndex = currentIndex <= 0 ? visibleTools.length - 1 : currentIndex - 1;
                        this.setEditorTool(visibleTools[nextIndex]);
                    }
                    break;
                case 'ArrowRight':
                case 'd':
                case 'D':
                    // 向右切换工具
                    e.preventDefault();
                    {
                        const visibleTools = getVisibleTools();
                        const currentIndex = visibleTools.indexOf(this.editor.tool);
                        const nextIndex = currentIndex >= visibleTools.length - 1 ? 0 : currentIndex + 1;
                        this.setEditorTool(visibleTools[nextIndex]);
                    }
                    break;
                case ' ':
                    // 空格键：回到起点所在的图层
                    e.preventDefault();
                    if (this.multiLayerMode) {
                        this.switchToLayer(this.playerLayer);
                    }
                    break;
            }
        }

        useStair() { if (this.multiLayerMode) { this.processAction({ type: 'USE_STAIR' }); } }
        movePlayer(dx, dy) { if (this.state === GAME_STATES.PLAYING) { this.processAction({ type: 'MOVE', payload: { dx, dy } }); } }
        pressButton(letter) { this.processAction({ type: 'PRESS_BUTTON', payload: { letter } }); }

        updateUIDisplays() {
            UI.updateUIDisplays({
                gameMode: this.gameMode,
                player: this.player,
                loopCount: this.loopCount,
                healthDisplay: this.healthDisplay,
                keysDisplay: this.keysDisplay,
                stepsDisplay: this.stepsDisplay
            });
            this.updateProximityWarning();
        }

        updateProximityWarning() {
            UI.updateProximityWarning({
                gameMode: this.gameMode,
                ghosts: this.ghosts,
                player: this.player,
                seenCells: this.seenCells,
                debugVision: this.debugVision,
                ghostProximityDisplay: this.ghostProximityDisplay
            });
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
            for (let y = 0; y <= this.height; y++) {
                for (let x = 0; x < this.width; x++) {
                    const isBoundary = Renderer.shouldDrawBoundary(x, y, true, this.activeCells, this.width, this.height);
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
                    const isBoundary = Renderer.shouldDrawBoundary(x, y, false, this.activeCells, this.width, this.height);
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
            Renderer.drawWallOrDoor(ctx, x1, y1, x2, y2, wallObject, this.cellSize, this.colors, this.state, isHighlight);
        }

        drawArrow(x1, y1, x2, y2, direction, color, withStroke) {
            Renderer.drawArrow(ctx, x1, y1, x2, y2, direction, color, withStroke, this.cellSize);
        }

        drawWallOverlays(inGame = false) {
            Renderer.drawWallOverlays(ctx, {
                width: this.width,
                height: this.height,
                cellSize: this.cellSize,
                hWalls: this.hWalls,
                vWalls: this.vWalls,
                activeCells: this.activeCells,
                seenCells: this.seenCells,
                debugVision: this.debugVision,
                colors: this.colors,
                inGame,
                drawArrowFn: (x1, y1, x2, y2, dir, color, stroke) => this.drawArrow(x1, y1, x2, y2, dir, color, stroke)
            });
        }

        drawCircle(x, y, color, alpha = 1.0) {
            Renderer.drawCircle(ctx, x, y, this.cellSize, color, alpha);
        }

        drawItem(item) {
            Renderer.drawItem(ctx, item, this.cellSize, this.colors);
        }

        drawStair(stair, isHighlight = false, alpha = 1.0) {
            Renderer.drawStair(ctx, stair, this.cellSize, this.colors, isHighlight, alpha);
        }

        drawButton(button, isHighlight = false) {
            Renderer.drawButton(ctx, button, this.cellSize, this.colors, isHighlight);
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
            const newLayer = LayerManager.createNewLayer(this.width, this.height);
            this.layers.push(newLayer); this.layerCount++;
            this.updateLayerPanel(); this.showToast(`已添加第 ${this.layerCount} 层`, 2000, 'success');
        }

        removeLayer() {
            if (this.layerCount <= 1) { this.showToast('初始的1层不可删除！', 3000, 'error'); return; }
            this.showConfirm(`确定要删除第 ${this.layerCount} 层吗？`, () => {
                // 保存当前层数据
                this._saveCurrentLayerData();
                
                this.layers.pop(); this.layerCount--;
                const removedLayerIndex = this.layerCount;
                LayerManager.cleanupStairsOnLayerRemove(this.layers, removedLayerIndex);
                
                // 清理全局楼梯数组中指向被删除层的楼梯
                this.stairs = this.stairs.filter(s => s.layer < this.layerCount);
                // 清理指向被删除层的成对楼梯
                this.stairs = this.stairs.filter(s => {
                    const targetLayer = s.direction === 'up' ? s.layer + 1 : s.layer - 1;
                    return targetLayer >= 0 && targetLayer < this.layerCount;
                });
                
                // 如果当前视图在被删除的顶层，强制切换到新的顶层
                if (this.currentLayer >= this.layerCount) {
                    this.currentLayer = this.layerCount - 1;
                    this._switchToLayer(this.currentLayer);
                    this._renderStaticLayer();
                    this.drawEditor();
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
            // 检查是否有起点设置
            let hasStartPoint = false;
            if (this.editor.active) {
                // 编辑器模式下检查
                if (this.editor.mode === 'regular') {
                    hasStartPoint = true; // 常规模式总是有起点
                } else {
                    // 自由模式下检查所有层是否有 customStartPos
                    if (this.multiLayerMode) {
                        for (let i = 0; i < this.layerCount; i++) {
                            if (this.layers[i] && this.layers[i].customStartPos) {
                                hasStartPoint = true;
                                break;
                            }
                        }
                        // 也检查当前编辑层的 customStartPos
                        if (!hasStartPoint && this.customStartPos) {
                            hasStartPoint = true;
                        }
                    } else {
                        hasStartPoint = !!this.customStartPos;
                    }
                }
            } else {
                // 游戏模式下总是有起点
                hasStartPoint = true;
            }
            
            LayerManager.updateLayerPanelUI({
                multiLayerMode: this.multiLayerMode,
                layerCount: this.layerCount,
                currentLayer: this.currentLayer,
                playerLayer: this.playerLayer,
                editorActive: this.editor.active,
                hasStartPoint: hasStartPoint,
                onLayerClick: (i) => this.switchToLayer(i)
            });
        }

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
                        hWalls: Editor.createEmptyWalls('h', size, size), vWalls: Editor.createEmptyWalls('v', size, size),
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
            
            // 清空当前层的楼梯，同时清除成对的楼梯
            const currentLayerStairs = this.stairs.filter(s => s.layer === this.currentLayer);
            currentLayerStairs.forEach(stair => {
                const pairedLayer = stair.direction === 'up' ? stair.layer + 1 : stair.layer - 1;
                const pairedDirection = stair.direction === 'up' ? 'down' : 'up';
                // 移除成对的楼梯
                this.stairs = this.stairs.filter(s => 
                    !(s.x === stair.x && s.y === stair.y && s.layer === pairedLayer && s.direction === pairedDirection)
                );
            });
            // 移除当前层的所有楼梯
            this.stairs = this.stairs.filter(s => s.layer !== this.currentLayer);
            
            // 更新层面板（起点被删除后不应显示黄色边框）
            this.updateLayerPanel();
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
            for (let y = 0; y <= this.height; y++) {
                for (let x = 0; x < this.width; x++) {
                    const isActiveRow = (y < this.height && this.activeCells[y][x]) || (y > 0 && this.activeCells[y - 1][x]);
                    if (!isActiveRow) continue;
                    if (this.hWalls[y][x].type > 0) this.drawWallOrDoor(x * cs, y * cs, (x + 1) * cs, y * cs, this.hWalls[y][x]);
                    else if (this.editor.mode === 'free' && Renderer.shouldDrawBoundary(x, y, true, this.activeCells, this.width, this.height)) this.drawWallOrDoor(x * cs, y * cs, (x + 1) * cs, y * cs, { type: 1 });
                }
            }
            for (let y = 0; y < this.height; y++) {
                for (let x = 0; x <= this.width; x++) {
                    const isActiveCol = (x < this.width && this.activeCells[y][x]) || (x > 0 && this.activeCells[y][x - 1]);
                    if (!isActiveCol) continue;
                    if (this.vWalls[y][x].type > 0) this.drawWallOrDoor(x * cs, y * cs, x * cs, (y + 1) * cs, this.vWalls[y][x]);
                    else if (this.editor.mode === 'free' && Renderer.shouldDrawBoundary(x, y, false, this.activeCells, this.width, this.height)) this.drawWallOrDoor(x * cs, y * cs, x * cs, (y + 1) * cs, { type: 1 });
                }
            }
            ctx.stroke();
            this.drawCorners(true); this.drawWallOverlays();
            if (this.editor.tool === EDITOR_TOOLS.GRID && this.editor.hoveredWall) {
                const { x, y } = this.editor.hoveredWall;
                if (x >= 0 && x < this.width && y >= 0 && y < this.height) { ctx.fillStyle = "rgba(255, 255, 0, 0.3)"; ctx.fillRect(x * cs, y * cs, cs, cs); }
            } else if (this.editor.hoveredWall && !this.editor.isDragging) {
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
            // 右键橡皮擦时显示小圆点提示
            if (this.editor.isRightClickErasing && this.editor.rightClickMousePos) {
                ctx.fillStyle = this.colors.hoverHighlight || '#ffc107';
                ctx.beginPath();
                ctx.arc(this.editor.rightClickMousePos.x, this.editor.rightClickMousePos.y, 5, 0, 2 * Math.PI);
                ctx.fill();
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
                return Editor.isPosInStartRoom(cellX, cellY, this.height);
            }
            return false;
        }

        isWallEditable(wall) {
            return Editor.isWallEditable(wall, this.editor.mode, this.width, this.height, this.activeCells);
        }

        isCellOccupiedInEditor(x, y) {
            return Editor.isCellOccupied(x, y, {
                ghosts: this.ghosts,
                items: this.items,
                buttons: this.buttons,
                endPos: this.endPos,
                customStartPos: this.customStartPos,
                stairs: this.stairs,
                currentLayer: this.currentLayer
            });
        }

        eraseAtPos(pos) {
            const wall = this.getWallAtPos(pos.x, pos.y);
            if (wall && this.isWallEditable(wall)) {
                // 先清除该墙上的按钮（requirement 8：按钮必须依附在墙上）
                this.eraseButtonsOnWall(wall);
                if (wall.type === 'h') this.hWalls[wall.y][wall.x] = { type: WALL_TYPES.EMPTY, keys: 0 };
                else this.vWalls[wall.y][wall.x] = { type: WALL_TYPES.EMPTY, keys: 0 };
            }
            const cellX = Math.floor(pos.x / this.cellSize); const cellY = Math.floor(pos.y / this.cellSize);
            if (this.editor.mode === 'free' || !this.isPosInStartRoom(cellX, cellY)) {
                if (this.endPos && this.endPos.x === cellX && this.endPos.y === cellY) { this.endPos = null; }
                if (this.customStartPos && this.customStartPos.x === cellX && this.customStartPos.y === cellY) { this.customStartPos = null; }
                this.ghosts = this.ghosts.filter(g => g.x !== cellX || g.y !== cellY);
                this.items = this.items.filter(i => i.x !== cellX || i.y !== cellY);
                // 擦除按钮（requirement 5）
                this.buttons = this.buttons.filter(b => b.x !== cellX || b.y !== cellY);
                this.eraseStairAt(cellX, cellY, this.currentLayer);
            }
            this.drawEditor();
        }

        // 清除依附在指定墙上的按钮（requirement 8）
        eraseButtonsOnWall(wall) {
            if (wall.type === 'h') {
                // 横墙：上方的格子按钮方向为 dy=1，下方的格子按钮方向为 dy=-1
                this.buttons = this.buttons.filter(b => {
                    // 上方格子（y = wall.y - 1）的下边按钮
                    if (b.x === wall.x && b.y === wall.y - 1 && b.direction.dy === 1) return false;
                    // 下方格子（y = wall.y）的上边按钮
                    if (b.x === wall.x && b.y === wall.y && b.direction.dy === -1) return false;
                    return true;
                });
            } else {
                // 竖墙：左方的格子按钮方向为 dx=1，右方的格子按钮方向为 dx=-1
                this.buttons = this.buttons.filter(b => {
                    // 左方格子（x = wall.x - 1）的右边按钮
                    if (b.x === wall.x - 1 && b.y === wall.y && b.direction.dx === 1) return false;
                    // 右方格子（x = wall.x）的左边按钮
                    if (b.x === wall.x && b.y === wall.y && b.direction.dx === -1) return false;
                    return true;
                });
            }
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
            
            // 右键点击处理（橡皮擦功能）
            if (e.button === 2) {
                e.preventDefault();
                this.editor.isRightClickErasing = true;
                const pos = this.getMousePos(e);
                this.editor.rightClickMousePos = pos;
                this.eraseAtPos(pos);
                return;
            }
            
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
            } else if (this.editor.tool === EDITOR_TOOLS.ONE_WAY) {
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
            
            // 右键拖动橡皮擦
            if (this.editor.isRightClickErasing) {
                this.editor.rightClickMousePos = pos;
                this.eraseAtPos(pos);
                return;
            }
            
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
            } else if (this.editor.tool === EDITOR_TOOLS.ONE_WAY && this.editor.lastDragPos) {
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
            
            // 检查当前层该位置是否有其他元素（起点、鬼、钥匙、其他楼梯等）
            if (this.isCellOccupiedInEditor(x, y)) return false;
            
            // 检查目标层该位置是否有其他元素
            if (this.layers[targetLayer]) {
                const targetLayerData = this.layers[targetLayer];
                // 检查目标层是否有起点
                if (targetLayerData.customStartPos && targetLayerData.customStartPos.x === x && targetLayerData.customStartPos.y === y) return false;
                // 检查目标层是否有终点
                if (targetLayerData.endPos && targetLayerData.endPos.x === x && targetLayerData.endPos.y === y) return false;
                // 检查目标层是否有鬼
                if (targetLayerData.ghosts && targetLayerData.ghosts.some(g => g.x === x && g.y === y)) return false;
                // 检查目标层是否有钥匙
                if (targetLayerData.items && targetLayerData.items.some(i => i.x === x && i.y === y)) return false;
                // 检查目标层该位置是否已有楼梯（不是配对的那个）
                if (this.stairs.some(s => s.x === x && s.y === y && s.layer === targetLayer && s.direction !== (direction === 'up' ? 'down' : 'up'))) return false;
            }
            
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
            
            // 右键松开时结束橡皮擦模式
            if (e.button === 2 || this.editor.isRightClickErasing) {
                this.editor.isRightClickErasing = false;
                this.editor.rightClickMousePos = null;
                this.drawEditor();
                return;
            }
            
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
            // 清除所有悬停状态
            if (this.editor.hoveredWall) { this.editor.hoveredWall = null; this.drawEditor(); }
            if (this.editor.hoveredButtonHotspot) { this.editor.hoveredButtonHotspot = null; this.drawEditor(); }
            // 如果正在右键橡皮擦，也要停止
            if (this.editor.isRightClickErasing) {
                this.editor.isRightClickErasing = false;
                this.editor.rightClickMousePos = null;
                this.drawEditor();
            }
            this.editor.dragAxis = null; this.editor.lastDragPos = null;
        }

        getWallAtPos(mouseX, mouseY) {
            return Editor.getWallAtPos(mouseX, mouseY, this.cellSize, this.width, this.height, this.editor.tool);
        }

        getButtonHotspotAtPos(mouseX, mouseY) {
            return Pathfinding.getButtonHotspotAtPos(mouseX, mouseY, {
                cellSize: this.cellSize,
                width: this.width,
                height: this.height,
                activeCells: this.activeCells,
                hWalls: this.hWalls,
                vWalls: this.vWalls,
                editorMode: this.editor.mode
            });
        }

        toggleWall(wall, targetType = WALL_TYPES.SOLID) {
            const { x, y, type } = wall;
            let currentWallObj;
            if (type === 'h' && y >= 0 && y <= this.height && x >= 0 && x < this.width) {
                currentWallObj = this.hWalls[y][x];
                const newType = currentWallObj.type === targetType ? WALL_TYPES.EMPTY : targetType;
                // 如果要清空墙类型或替换为其他类型，先清除依附的按钮
                if (newType === WALL_TYPES.EMPTY || (currentWallObj.type === WALL_TYPES.SOLID && targetType !== WALL_TYPES.SOLID)) {
                    this.eraseButtonsOnWall(wall);
                }
                this.hWalls[y][x].type = newType;
            } else if (type === 'v' && x >= 0 && x <= this.width && y >= 0 && y < this.height) {
                currentWallObj = this.vWalls[y][x];
                const newType = currentWallObj.type === targetType ? WALL_TYPES.EMPTY : targetType;
                // 如果要清空墙类型或替换为其他类型，先清除依附的按钮
                if (newType === WALL_TYPES.EMPTY || (currentWallObj.type === WALL_TYPES.SOLID && targetType !== WALL_TYPES.SOLID)) {
                    this.eraseButtonsOnWall(wall);
                }
                this.vWalls[y][x].type = newType;
            }
            this.drawEditor();
        }

        getMouseSideOfWall(mouseX, mouseY, wall) {
            const cs = this.cellSize;
            if (wall.type === 'h') { return (mouseY > wall.y * cs) ? { dx: 0, dy: 1 } : { dx: 0, dy: -1 }; }
            else { return (mouseX > wall.x * cs) ? { dx: 1, dy: 0 } : { dx: -1, dy: 0 }; }
        }

        calculateDistances(startNode) {
            return Pathfinding.calculateDistances(startNode, this.width, this.height, this.hWalls, this.vWalls);
        }

        findPlayerPath(start, end) {
            return Pathfinding.findPlayerPath(start, end, {
                width: this.width,
                height: this.height,
                hWalls: this.hWalls,
                vWalls: this.vWalls,
                seenCells: this.seenCells,
                debugVision: this.debugVision,
                playerKeys: this.player.keys
            });
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
            UI.updateHistoryButtons({
                currentStep: this.currentStep,
                history: this.history,
                checkpoints: this.checkpoints
            });
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
