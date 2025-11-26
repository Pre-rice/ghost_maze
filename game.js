    // ==================================================
    //  常量定义
    // ==================================================
    const WALL_TYPES = {
        EMPTY: 0,
        SOLID: 1,
        DOOR: 2,
        LOCKED: 3,
        ONE_WAY: 4,
        GLASS: 5,
        LETTER_DOOR: 6
    };

    const GAME_STATES = {
        MENU: 'menu',
        PLAYING: 'playing',
        DEAD: 'dead',
        WON: 'won',
        EDITOR: 'editor'
    };

    const EDITOR_TOOLS = {
        WALL: 'wall',
        GLASS: 'glass',
        DOOR: 'door',
        ONE_WAY: 'oneway',
        LOCK: 'lock',
        LETTER_DOOR: 'letter',
        BUTTON: 'button',
        GHOST: 'ghost',
        KEY: 'key',
        START: 'start', // 新增起点工具
        END: 'end',
        STAIR: 'stair', // 新增楼梯工具
        ERASER: 'eraser',
        GRID: 'grid' // 新增地图方格工具
    };

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
            // 清空
            document.documentElement.classList.remove("light", "dark");

            if (mode === "light") {
                document.documentElement.classList.add("light");
                themeIcon.innerHTML = sunIcon;
                toggleBtn.classList.remove("active");
            }
            else if (mode === "dark") {
                document.documentElement.classList.add("dark");
                themeIcon.innerHTML = moonIcon;
                toggleBtn.classList.add("active");
            }
            else {
                // 系统模式
                const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
                themeIcon.innerHTML = systemIcon;
                toggleBtn.classList.toggle("active", systemDark);
            }
        }

        // 初始化
        let saved = localStorage.getItem("theme") || "auto";
        applyTheme(saved);

        // 点击循环切换：light → dark → auto
        document.getElementById("theme-toggle").addEventListener("click", () => {
            let current = localStorage.getItem("theme") || "auto";
            let next = current === "light" ? "dark" : current === "dark" ? "auto" : "light";

            applyTheme(next);
            localStorage.setItem("theme", next);

            // 如果游戏实例已存在，通知它刷新主题颜色
            if (typeof game !== 'undefined') {
                game.refreshTheme();
            }
        });

        // 获取Canvas元素及其2D渲染上下文
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

                // 新增：视口偏移（用于居中非标准地图）
                this.drawOffset = { x: 0, y: 0 };

                // 玩家状态
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
                    grip: document.getElementById('dpad-grip'),
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

            /**
             * 从 CSS 变量重新读取所有颜色配置
             */
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
                    startPoint: computedStyle.getPropertyValue('--start-point-color').trim(), // New
                    key: computedStyle.getPropertyValue('--key-color').trim(),
                    startRoomHighlight: computedStyle.getPropertyValue('--start-room-highlight').trim(),
                    hoverHighlight: computedStyle.getPropertyValue('--hover-highlight-color').trim(),
                    // 新增：将文本颜色也存入配置
                    text: computedStyle.getPropertyValue('--text-color').trim(),
                    voidGrid: computedStyle.getPropertyValue('--void-grid-color').trim() // New
                };
            }

            /**
             * 刷新主题：更新颜色并重绘界面
             */
            refreshTheme() {
                this.updateColors(); // 重新获取新主题的颜色
                
                if (this.state === GAME_STATES.MENU) {
                    this.showInitialMessage(); // 如果在菜单界面，重绘欢迎语
                } else {
                    this._renderStaticLayer(); // 重绘背景层（地面颜色变了）
                    this.draw(); // 重绘游戏画面
                }
            }
            
            /**
            * 从 URL 自动解析分享码，例如：
            *   https://xxx.com/?map=xxxx
            *   https://xxx.com/#xxxx
            * 自动加载地图。
            */
            loadShareCodeFromURL() {
                // 1. 从 ?map= 获取
                const params = new URLSearchParams(window.location.search);
                let code = params.get("map");

                // 2. 若没有，从 #hash 获取
                if (!code && window.location.hash) {
                    code = window.location.hash.substring(1);
                }

                if (!code) return;  // URL 没有分享码，则不处理

                this.showToast("检测到分享码，正在加载…", 2000);

                try {
                    this.loadFromShareCode(code);
                } catch (e) {
                    console.error(e);
                    this.showToast("分享码无效或无法解析", 3000, "error");
                }
            }

            /**
             * 在游戏开始前，在Canvas上显示欢迎信息
             */
            showInitialMessage() {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                
                // 绘制未加载时的边框 (缩进 padding 大小，模拟地图边界)
                ctx.strokeStyle = this.colors.border; // 使用定义好的边框颜色
                if (!this.colors.border) ctx.strokeStyle = '#d9d9d9'; // 降级处理
                ctx.lineWidth = 2;
                // 绘制虚线边框以示区分
                ctx.setLineDash([5, 5]);
                ctx.strokeRect(this.padding, this.padding, canvas.width - 2 * this.padding, canvas.height - 2 * this.padding);
                ctx.setLineDash([]);

                ctx.fillStyle = this.colors.text;
                ctx.font = '20px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('点击 "随机生成新地图" 或加载分享码开始游戏', canvas.width / 2, canvas.height / 2);
            }

            // ==================================================
            //  UI绑定与控制
            // ==================================================

            /**
             * 绑定所有HTML元素的事件监听器
             */
            bindUI() {
                // Home 按钮逻辑 (回到纯路径，去除 ?map=... 和 #...)
                document.getElementById('home-btn').addEventListener('click', () => {
                    window.location.href = window.location.pathname;
                });

                // 游戏控制按钮
                document.getElementById('generate-map-btn').addEventListener('click', () => this.generateNewRandomMap());
                document.getElementById('reset-map-btn').addEventListener('click', () => this.resetCurrentMap());
                document.getElementById('edit-map-btn').addEventListener('click', () => this.enterEditorMode());

                // 分享码功能按钮 (主界面和编辑器)
                document.getElementById('copy-share-code-btn').addEventListener('click', () => this.copyShareCode());
                document.getElementById('editor-copy-share-code-btn').addEventListener('click', () => this.copyShareCode(true));
                document.getElementById('load-share-code-btn').addEventListener('click', () => this._loadCodeFromClipboard(false));
                document.getElementById('editor-load-share-code-btn').addEventListener('click', () => this._loadCodeFromClipboard(true));

                // 调试视野开关
                document.getElementById('debug-vision-toggle').addEventListener('change', (e) => {
                    this.debugVision = e.target.checked;
                    this.draw();
                    if (this.state === GAME_STATES.PLAYING) {
                        this.updateProximityWarning();
                    }
                });

                // 游戏模式选择按钮
                document.getElementById('mode-exploration-btn').addEventListener('click', () => this.setGameMode('exploration'));
                document.getElementById('mode-death-loop-btn').addEventListener('click', () => this.setGameMode('death-loop'));
                document.getElementById('editor-mode-exploration-btn').addEventListener('click', () => this.setGameMode('exploration', true));
                document.getElementById('editor-mode-death-loop-btn').addEventListener('click', () => this.setGameMode('death-loop', true));

                // 游戏结束/胜利浮窗中的按钮
                document.getElementById('revive-btn').addEventListener('click', () => this.revivePlayer());
                document.getElementById('game-over-replay-btn').addEventListener('click', () => this.resetCurrentMap());
                document.getElementById('game-over-new-map-btn').addEventListener('click', () => this.generateNewRandomMap());
                document.getElementById('win-replay-btn').addEventListener('click', () => this.resetCurrentMap());
                document.getElementById('win-new-map-btn').addEventListener('click', () => this.generateNewRandomMap());

                // 编辑器工具栏按钮
                document.querySelectorAll('.tool-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => this.setEditorTool(e.target.id.split('-')[1]));
                });
                this.editorMapSizeInput.addEventListener('change', () => this.resizeAndClearEditor());
                document.getElementById('play-edited-map-btn').addEventListener('click', () => this.playEditedMap());
                document.getElementById('clear-map-btn').addEventListener('click', () => this.clearEditorMap());
                
                // 全局键盘事件
                window.addEventListener('keydown', (e) => this.handleKeyPress(e));
                
                // Canvas上的鼠标事件 (主要用于编辑器和玩家点击移动)
                // 包装器用于在移动端将 TouchEvent 转换为 MouseLike 对象
                const touchWrapper = (handler) => (e) => { if(this.editor.active) { e.preventDefault(); handler(e.changedTouches[0]); }};
                
                canvas.addEventListener('click', (e) => this.handleCanvasClick(e));
                canvas.addEventListener('mousedown', (e) => this.handleCanvasMouseDown(e));
                canvas.addEventListener('mousemove', (e) => this.handleCanvasMouseMove(e));
                canvas.addEventListener('mouseup', (e) => this.handleCanvasMouseUp(e));
                canvas.addEventListener('mouseleave', (e) => this.handleCanvasMouseLeave(e));

                // Canvas上的触摸事件 (移动端编辑器支持)
                canvas.addEventListener('touchstart', touchWrapper(this.handleCanvasMouseDown.bind(this)), { passive: false });
                canvas.addEventListener('touchmove', touchWrapper(this.handleCanvasMouseMove.bind(this)), { passive: false });
                canvas.addEventListener('touchend', touchWrapper(this.handleCanvasMouseUp.bind(this)), { passive: false });
                canvas.addEventListener('touchcancel', touchWrapper(this.handleCanvasMouseUp.bind(this)), { passive: false });

                // 虚拟方向键(D-pad)相关绑定
                this.bindDpadControls();
                document.getElementById('dpad-toggle').addEventListener('change', (e) => {
                    this.updateDpadVisibility();
                });
                this.initializeDpadTouchControls();

                // 历史记录系统按钮
                document.getElementById('undo-btn').addEventListener('click', () => this.handleUndo());
                document.getElementById('save-btn').addEventListener('click', () => this.handleSave());
                document.getElementById('rewind-btn').addEventListener('click', () => this.handleRewind());

                // 新增：编辑模式切换
                document.getElementById('edit-type-regular-btn').addEventListener('click', () => this.attemptSetEditorMode('regular'));
                document.getElementById('edit-type-free-btn').addEventListener('click', () => this.attemptSetEditorMode('free'));

                // 新增：图层模式切换
                document.getElementById('layer-mode-single-btn').addEventListener('click', () => this.setLayerMode(false));
                document.getElementById('layer-mode-multi-btn').addEventListener('click', () => this.setLayerMode(true));
                
                // 新增：图层管理按钮
                document.getElementById('layer-add-btn').addEventListener('click', () => this.addLayer());
                document.getElementById('layer-remove-btn').addEventListener('click', () => this.removeLayer());
            }

            /**
             * 初始化虚拟方向键的拖动和缩放功能
             */
            initializeDpadTouchControls() {
                const dpad = this.dpad;

                // 从localStorage加载并应用上次保存的位置和大小
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

                // 辅助函数，确保D-pad使用JS计算的绝对定位
                const ensureJsPositioning = () => {
                    if (dpad.element.style.left === '' || dpad.element.style.top === '') {
                        const rect = dpad.element.getBoundingClientRect();
                        dpad.element.style.left = `${rect.left}px`;
                        dpad.element.style.top = `${rect.top}px`;
                        dpad.element.style.right = 'auto';
                        dpad.element.style.bottom = 'auto';
                    }
                };

                // 绑定单指拖动事件到中心把手
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

                // 绑定双指缩放事件到整个D-pad容器
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

                // 监听全局触摸移动事件
                document.addEventListener('touchmove', (e) => {
                    if (!dpad.isDragging && !dpad.isResizing) return;
                    e.preventDefault();
                    const touches = e.touches;

                    if (dpad.isDragging && touches.length === 1) { // 处理拖动
                        const dx = touches[0].clientX - dpad.startX;
                        const dy = touches[0].clientY - dpad.startY;
                        dpad.element.style.left = `${dpad.initialLeft + dx}px`;
                        dpad.element.style.top = `${dpad.initialTop + dy}px`;
                    } else if (dpad.isResizing && touches.length === 2) { // 处理缩放
                        const dx = touches[0].clientX - touches[1].clientX;
                        const dy = touches[0].clientY - touches[1].clientY;
                        const currentDist = Math.sqrt(dx * dx + dy * dy);
                        const scaleChange = currentDist / dpad.initialDist;
                        let newScale = dpad.currentScale * scaleChange;
                        newScale = Math.max(0.5, Math.min(2.5, newScale)); // 限制缩放范围
                        dpad.element.style.transform = `scale(${newScale})`;
                    }
                }, { passive: false });

                // 监听全局触摸结束事件，保存状态
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
             * 设置游戏模式并更新相关的UI显示
             * @param {string} newMode - 新的游戏模式 ('exploration' 或 'death-loop')
             * @param {boolean} fromEditor - 调用是否来自编辑器界面
             */
            setGameMode(newMode, fromEditor = false) {
                if (this.gameMode === newMode && !fromEditor) return;
                this.gameMode = newMode;

                const isExploration = newMode === 'exploration';

                // 更新主界面和编辑器界面中模式按钮的激活状态
                document.getElementById('mode-exploration-btn').classList.toggle('active', isExploration);
                document.getElementById('mode-death-loop-btn').classList.toggle('active', !isExploration);
                document.getElementById('editor-mode-exploration-btn').classList.toggle('active', isExploration);
                document.getElementById('editor-mode-death-loop-btn').classList.toggle('active', !isExploration);

                // 根据模式切换显示对应的状态栏
                document.getElementById('status-bar-exploration').style.display = isExploration ? 'flex' : 'none';
                document.getElementById('status-bar-death-loop').style.display = isExploration ? 'none' : 'flex';

                // 根据模式切换编辑器中显示初始生命/体力输入框
                document.getElementById('initial-health-container').style.display = isExploration ? 'flex' : 'none';
                document.getElementById('initial-stamina-container').style.display = isExploration ? 'none' : 'flex';

                // 如果在游戏中切换模式，则重置当前地图
                if (this.state !== GAME_STATES.MENU && this.state !== GAME_STATES.EDITOR) {
                    this.resetCurrentMap();
                }
                this.updateUIDisplays();
            }

            /**
             * 根据开关状态和游戏模式更新虚拟方向键的可见性
             */
            updateDpadVisibility() {
                const dpadToggle = document.getElementById('dpad-toggle');
                const dpadControls = document.getElementById('dpad-controls');
                const shouldShow = dpadToggle.checked && !this.editor.active;

                if (shouldShow) {
                    dpadControls.classList.remove('hidden');
                } else {
                    dpadControls.classList.add('hidden');
                }
            }

            /**
             * 绑定虚拟方向键按钮的触摸和点击事件
             */
            bindDpadControls() {
                const upBtn = document.getElementById('dpad-up');
                const downBtn = document.getElementById('dpad-down');
                const leftBtn = document.getElementById('dpad-left');
                const rightBtn = document.getElementById('dpad-right');

                // 按下按钮时的处理函数，支持长按连续移动
                const handleDpadPress = (dx, dy) => {
                    if (this.state !== GAME_STATES.PLAYING) return;
                    clearInterval(this.autoMoveInterval);
                    clearInterval(this.dpadInterval);
                    this.movePlayer(dx, dy); // 立即移动一次
                    this.dpadInterval = setInterval(() => { // 设置定时器实现长按效果
                        this.movePlayer(dx, dy);
                    }, 200);
                };

                // 释放按钮时的处理函数
                const handleDpadRelease = () => {
                    clearInterval(this.dpadInterval);
                };

                // 辅助函数，为按钮添加事件监听
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

                // 监听全局的释放事件
                document.addEventListener('touchend', handleDpadRelease);
                document.addEventListener('mouseup', handleDpadRelease);
            }

            // ==================================================
            //  自定义通知与动画
            // ==================================================

            /**
             * 显示一个短暂的顶部通知 (Toast)
             * @param {string} message - 要显示的消息
             * @param {number} duration - 显示时长 (毫秒)
             * @param {string} type - 通知类型 ('info', 'success', 'error')
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
             * @param {string} message - 确认信息
             * @param {function} onConfirm - 用户点击确认后执行的回调函数
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
             * 启动基于 requestAnimationFrame 的动画循环，用于渲染拖尾等效果
             */
            startAnimationLoop() {
                if (this.animationFrameId) return;
                const trailLifetime = 500; // 拖尾效果的持续时间

                const loop = () => {
                    const now = Date.now();
                    
                    // 过滤掉已经过期的拖尾点
                    this.player.trail = this.player.trail.filter(p => now - p.timestamp < trailLifetime);
                    this.ghosts.forEach(g => {
                        g.trail = g.trail.filter(p => now - p.timestamp < trailLifetime);
                    });

                    if (this.state === GAME_STATES.PLAYING) {
                        this.draw(); // 重绘画面
                        this.animationFrameId = requestAnimationFrame(loop);
                    } else {
                        this.stopAnimationLoop();
                    }
                };
                this.animationFrameId = requestAnimationFrame(loop);
            }

            /**
             * 停止动画循环
             */
            stopAnimationLoop() {
                if (this.animationFrameId) {
                    cancelAnimationFrame(this.animationFrameId);
                    this.animationFrameId = null;
                }
            }

            // ==================================================
            //  游戏初始化与状态管理
            // ==================================================
            
            /**
             * 根据提供的地图数据开始或重置游戏
             * @param {object} mapData - 包含地图所有信息的对象
             */
            startGame(mapData) {
                this.stopAnimationLoop();
                this.mapData = JSON.parse(JSON.stringify(mapData)); // 深拷贝地图数据以备重置
                this.state = GAME_STATES.PLAYING;

                // 重置历史记录系统
                this.history = [];
                this.checkpoints = [];
                this.currentStep = -1;
                
                // 应用地图尺寸
                this.width = mapData.width;
                this.height = mapData.height;
                this.padding = 15; // 新增：定义内边距
                this.cellSize = (canvas.width - 2 * this.padding) / this.width; // 修改：计算单元格大小时预留边距
                this.startPos = { x: 1, y: this.height - 2 };
                
                // 新增：加载自由模式数据
                this.editor.mode = mapData.editorMode || 'regular';
                this.activeCells = mapData.activeCells || Array(this.height).fill(null).map(()=>Array(this.width).fill(true));
                this.customStartPos = mapData.customStartPos || null;

                // 加载多层地图数据
                this.multiLayerMode = mapData.multiLayerMode || false;
                this.layerCount = mapData.layerCount || 1;
                this.currentLayer = 0;
                this.playerLayer = 0;
                this.stairs = JSON.parse(JSON.stringify(mapData.stairs || []));
                this.layers = JSON.parse(JSON.stringify(mapData.layers || []));

                // 计算视口偏移以居中地图（考虑所有图层）
                this.calculateDrawOffset();

                this._renderStaticLayer(); // 渲染静态背景层
                
                // 加载地图结构
                this.hWalls = JSON.parse(JSON.stringify(mapData.hWalls)); // 使用深拷贝
                this.vWalls = JSON.parse(JSON.stringify(mapData.vWalls)); // 使用深拷贝
                this.endPos = mapData.endPos;
                this.items = mapData.items || [];
                this.buttons = mapData.buttons || []; // 加载按钮

                // 初始化所有字母门的当前状态
                this.hWalls.forEach(row => row.forEach(wall => {
                    if (wall.type === WALL_TYPES.LETTER_DOOR) {
                        wall.currentState = wall.initialState || 'closed';
                    }
                }));
                this.vWalls.forEach(row => row.forEach(wall => {
                    if (wall.type === WALL_TYPES.LETTER_DOOR) {
                        wall.currentState = wall.initialState || 'closed';
                    }
                }));
                
                // 初始化玩家状态：如果自由模式有自定义起点，使用它；否则使用默认
                const start = this.customStartPos || this.startPos;
                this.player = { x: start.x, y: start.y, hp: this.initialHealth, stamina: this.initialStamina, trail: [], keys: 0 , steps: 0};
                if (this.gameMode === 'exploration') {
                    this.player.hp = this.initialHealth;
                } else {
                    this.player.stamina = this.initialStamina;
                    this.loopCount = 0;
                }
                
                // 初始化鬼的状态
                this.ghosts = JSON.parse(JSON.stringify(mapData.initialGhosts));
                this.ghosts.forEach(g => g.trail = []);
                
                // 仅在全新开始或探索模式下重置视野
                if (this.gameMode === 'exploration' || this.loopCount === 0) {
                    this.seenCells = Array(this.height).fill(null).map(() => Array(this.width).fill(false));
                }
                this.updateVisibility();
                
                // 更新UI，隐藏浮窗，并开始游戏循环
                this.updateUIDisplays();
                this.hideAllOverlays();
                this.updateLayerPanel(); // 更新图层面板
                this.startAnimationLoop();

                // 记录游戏的初始状态
                this.recordHistory();

                // 在这里自动生成分享码并更新 URL
                // 使用 setTimeout 确保在当前执行栈清空后执行，避免任何潜在的时序问题
                setTimeout(() => {
                    const code = this.generateShareCode();
                    this.updateURLWithShareCode(code);
                }, 0);
            }

            calculateDrawOffset() {
                // 仅在非编辑器模式下计算偏移
                if (this.state === GAME_STATES.EDITOR) {
                    this.drawOffset = { x: 0, y: 0 };
                    return;
                }

                let minX = this.width, maxX = 0, minY = this.height, maxY = 0;
                let hasActive = false;
                for(let y=0; y<this.height; y++) {
                    for(let x=0; x<this.width; x++) {
                        if(this.activeCells[y][x]) {
                            hasActive = true;
                            if(x < minX) minX = x;
                            if(x > maxX) maxX = x;
                            if(y < minY) minY = y;
                            if(y > maxY) maxY = y;
                        }
                    }
                }
                if (!hasActive) { this.drawOffset = {x:0, y:0}; return; }

                // 有效区域的像素宽度和高度
                const activeW = (maxX - minX + 1) * this.cellSize;
                const activeH = (maxY - minY + 1) * this.cellSize;
                
                // 居中偏移量 = (画布总宽 - 内容宽) / 2 - 内容左上角坐标
                const offsetX = (canvas.width - activeW) / 2 - (minX * this.cellSize);
                const offsetY = (canvas.height - activeH) / 2 - (minY * this.cellSize);
                
                this.drawOffset = { x: offsetX, y: offsetY };
            }

            /**
             * 生成一张新的随机地图并开始游戏
             */
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
                mapData.activeCells = Array(size).fill(null).map(()=>Array(size).fill(true));
                this.startGame(mapData);
            }
            
            /**
             * 重置当前地图，回到初始状态
             */
            resetCurrentMap() {
                if (!this.mapData) {
                    this.showToast("没有可重置的地图。请先生成一个新地图。", 3000, 'error');
                    return;
                }
                this.startGame(this.mapData);
            }

            // ==================================================
            //  地图生成
            // ==================================================

            /**
             * 使用随机深度优先搜索算法生成迷宫
             * @param {number} width - 地图宽度
             * @param {number} height - 地图高度
             * @returns {object} 生成的地图数据
             */
            generateMaze(width, height) {
                this.width = width;
                this.height = height;
                this.padding = 15; // 新增
                this.cellSize = (canvas.width - 2 * this.padding) / this.width; // 修改

                // 定义墙体、空地和门的基础对象
                const wall = () => ({ type: WALL_TYPES.SOLID, keys: 0 });
                const empty = () => ({ type: WALL_TYPES.EMPTY, keys: 0 });
                const door = () => ({ type: WALL_TYPES.DOOR, keys: 0 });

                // 1. 初始化，所有地方都是墙
                this.hWalls = Array(height + 1).fill(null).map(() => Array(width).fill(null).map(wall));
                this.vWalls = Array(height).fill(null).map(() => Array(width + 1).fill(null).map(wall));

                // 2. 创建一个3x3的固定起始房间
                const roomY = height - 3;
                for (let y = roomY; y < roomY + 3; y++) {
                    for (let x = 0; x < 3; x++) {
                        if (x < 2) this.vWalls[y][x + 1] = empty();
                        if (y < roomY + 2) this.hWalls[y + 1][x] = empty();
                    }
                }
                this.vWalls[roomY + 1][3] = door(); // 房间出口
                this.hWalls[roomY][1] = door(); // 房间出口
                this.startPos = { x: 1, y: height - 2 };

                // 3. 使用深度优先搜索(DFS)算法生成迷宫路径
                const visited = Array(height).fill(null).map(() => Array(width).fill(false));
                for (let y = roomY; y < roomY + 3; y++) { // 标记起始房间为已访问
                    for (let x = 0; x < 3; x++) {
                        visited[y][x] = true;
                    }
                }
                
                const stack = [];
                let startGenX, startGenY;
                do { // 随机选择一个不在起始房间内的点开始生成
                    startGenX = Math.floor(Math.random() * width);
                    startGenY = Math.floor(Math.random() * height);
                } while (visited[startGenY][startGenX]);

                stack.push({ x: startGenX, y: startGenY });
                visited[startGenY][startGenX] = true;

                while (stack.length > 0) {
                    const current = stack.pop();
                    const neighbors = [];
                    const dirs = [{x:0, y:-1}, {x:1, y:0}, {x:0, y:1}, {x:-1, y:0}];
                    for (const dir of dirs) {
                        const nx = current.x + dir.x;
                        const ny = current.y + dir.y;
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height && !visited[ny][nx]) {
                            neighbors.push({ x: nx, y: ny, dir: dir });
                        }
                    }

                    if (neighbors.length > 0) {
                        stack.push(current);
                        const { x: nx, y: ny, dir } = neighbors[Math.floor(Math.random() * neighbors.length)];
                        // 打破当前单元格和邻居之间的墙
                        if (dir.x === 1) this.vWalls[current.y][current.x + 1] = empty();
                        else if (dir.x === -1) this.vWalls[current.y][current.x] = empty();
                        else if (dir.y === 1) this.hWalls[current.y + 1][current.x] = empty();
                        else if (dir.y === -1) this.hWalls[current.y][current.x] = empty();
                        visited[ny][nx] = true;
                        stack.push({ x: nx, y: ny });
                    }
                }
                
                // 4. 随机移除一些墙，增加迷宫的连通性
                const wallsToRemove = Math.floor(width * height * 0.08);
                let removedCount = 0;
                let attempts = 0;
                while (removedCount < wallsToRemove && attempts < wallsToRemove * 10) {
                    attempts++;
                    const rx = Math.floor(Math.random() * (width - 1));
                    const ry = Math.floor(Math.random() * (height - 1));

                    if (Math.random() > 0.5) {
                        if (rx < width - 1 && !(ry >= roomY && ry < roomY + 3 && rx + 1 === 3)) {
                            if (this.vWalls[ry][rx + 1].type === WALL_TYPES.SOLID) {
                                this.vWalls[ry][rx + 1] = empty();
                                removedCount++;
                            }
                        }
                    } else {
                        if (ry < height - 1 && !(rx >= 0 && rx < 3 && ry + 1 === roomY)) {
                             if (this.hWalls[ry + 1][rx].type === WALL_TYPES.SOLID) {
                                this.hWalls[ry + 1][rx] = empty();
                                removedCount++;
                            }
                        }
                    }
                }

                // 5. 找到离起点最远的死胡同作为终点
                this.endPos = this.findFarthestEndCell();

                // 6. 随机放置一些门
                const doorProbability = 0.02;
                for (let y = 0; y < this.height; y++) {
                    for (let x = 0; x < this.width; x++) {
                        const isNearEnd = (Math.abs(x - this.endPos.x) <= 1 && y === this.endPos.y) || (x === this.endPos.x && Math.abs(y - this.endPos.y) <= 1);
                        if (y < this.height - 1 && !this.isPosInStartRoom(x, y) && !this.isPosInStartRoom(x, y + 1) && !isNearEnd && Math.random() < doorProbability) this.hWalls[y + 1][x] = door();
                        if (x < width - 1 && !this.isPosInStartRoom(x, y) && !this.isPosInStartRoom(x + 1, y) && !isNearEnd && Math.random() < doorProbability) this.vWalls[y][x + 1] = door();
                    }
                }

                // 7. 在终点处放置一个需要3把钥匙的数字门
                const {x: ex, y: ey} = this.endPos;
                const lockedDoor = { type: WALL_TYPES.LOCKED, keys: 3 };
                if (this.hWalls[ey][ex].type === WALL_TYPES.EMPTY) this.hWalls[ey][ex] = lockedDoor;
                else if (this.hWalls[ey + 1][ex].type === WALL_TYPES.EMPTY) this.hWalls[ey + 1][ex] = lockedDoor;
                else if (this.vWalls[ey][ex].type === WALL_TYPES.EMPTY) this.vWalls[ey][ex] = lockedDoor;
                else if (this.vWalls[ey][ex + 1].type === WALL_TYPES.EMPTY) this.vWalls[ey][ex + 1] = lockedDoor;

                // 8. 随机放置鬼和钥匙
                const occupied = new Set(); // 记录已被占用的格子
                occupied.add(`${this.endPos.x},${this.endPos.y}`);
                for (let y = height - 3; y < height; y++) {
                    for (let x = 0; x < 3; x++) {
                        occupied.add(`${x},${y}`);
                    }
                }

                const initialGhosts = [];
                while (initialGhosts.length < this.ghostCount) {
                    const x = Math.floor(Math.random() * width);
                    const y = Math.floor(Math.random() * height);
                    const posKey = `${x},${y}`;
                    if (!occupied.has(posKey)) {
                        initialGhosts.push({ x, y, id: initialGhosts.length });
                        occupied.add(posKey);
                    }
                }

                this.items = [];
                const keysToPlace = 4;
                const validCells = []; // 所有可放置物品的格子
                const preferredCells = []; // 优先放置物品的格子 (死胡同)
                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        if (!occupied.has(`${x},${y}`)) {
                            validCells.push({x, y});
                            let wallCount = 0;
                            if (this.hWalls[y][x].type > 0) wallCount++;
                            if (this.hWalls[y + 1][x].type > 0) wallCount++;
                            if (this.vWalls[y][x].type > 0) wallCount++;
                            if (this.vWalls[y][x + 1].type > 0) wallCount++;
                            if (wallCount >= 3) {
                                preferredCells.push({x, y});
                            }
                        }
                    }
                }

                for (let i = 0; i < keysToPlace; i++) {
                    let pos = null;
                    if (preferredCells.length > 0) { // 优先从死胡同中选择
                        const index = Math.floor(Math.random() * preferredCells.length);
                        pos = preferredCells.splice(index, 1)[0];
                    } else if (validCells.length > 0) {
                        const index = Math.floor(Math.random() * validCells.length);
                        pos = validCells.splice(index, 1)[0];
                    }
                    if (pos) {
                        this.items.push({ x: pos.x, y: pos.y, type: 'key' });
                        const validIndex = validCells.findIndex(c => c.x === pos.x && c.y === pos.y);
                        if (validIndex > -1) validCells.splice(validIndex, 1);
                    }
                }

                // 9. 返回完整的地图数据
                return {
                    width, height,
                    hWalls: this.hWalls, vWalls: this.vWalls,
                    endPos: this.endPos, initialGhosts: initialGhosts, items: this.items
                };
            }
            
            /**
             * 找到地图边界上离起点最远的死胡同作为终点
             * @returns {object} 终点坐标 {x, y}
             */
            findFarthestEndCell() {
                const distances = this.calculateDistances(this.startPos);
                let maxDist = -1;
                let farthestCell = null;

                for (let y = 0; y < this.height; y++) {
                    for (let x = 0; x < this.width; x++) {
                        // 只考虑地图边缘的格子
                        if (x === 0 || x === this.width - 1 || y === 0 || y === this.height - 1) {
                            let wallCount = 0;
                            if (this.hWalls[y][x].type > 0) wallCount++;
                            if (this.hWalls[y + 1][x].type > 0) wallCount++;
                            if (this.vWalls[y][x].type > 0) wallCount++;
                            if (this.vWalls[y][x + 1].type > 0) wallCount++;
                            
                            // 必须是死胡同 (三面是墙)
                            if (wallCount >= 3) {
                                if (distances[y][x] > maxDist) {
                                    maxDist = distances[y][x];
                                    farthestCell = { x, y };
                                }
                            }
                        }
                    }
                }
                return farthestCell || { x: this.width - 1, y: 0 }; // 如果没找到，提供一个默认值
            }

            // ==================================================
            //  玩家逻辑
            // ==================================================

            /**
             * 处理键盘按键事件
             * @param {KeyboardEvent} e - 键盘事件对象
             */
            handleKeyPress(e) {
                if (this.state !== GAME_STATES.PLAYING) return;
                this.stopAutoMove();
                
                // 多层模式下，任何移动键都强制切换到玩家所在层
                if (this.multiLayerMode && this.currentLayer !== this.playerLayer) {
                    this.switchToLayer(this.playerLayer);
                }

                let dx = 0, dy = 0;
                switch (e.key) {
                    case 'ArrowUp': case 'w': dy = -1; break;
                    case 'ArrowDown': case 's': dy = 1; break;
                    case 'ArrowLeft': case 'a': dx = -1; break;
                    case 'ArrowRight': case 'd': dx = 1; break;
                    case ' ': // 空格键：使用楼梯
                        e.preventDefault();
                        this.useStair();
                        return;
                    default: return;
                }
                e.preventDefault();
                this.movePlayer(dx, dy);
            }

            /**
             * 使用楼梯上下楼
             */
            useStair() {
                if (!this.multiLayerMode) return;
                
                // 检查玩家当前位置是否有楼梯
                const stair = this.stairs.find(s => 
                    s.x === this.player.x && 
                    s.y === this.player.y && 
                    s.layer === this.playerLayer
                );
                
                if (!stair) return;
                
                // 计算目标层
                const targetLayer = stair.direction === 'up' ? this.playerLayer + 1 : this.playerLayer - 1;
                
                // 验证目标层有效
                if (targetLayer < 0 || targetLayer >= this.layerCount) return;
                
                // 检查目标层对应位置是否有对应楼梯
                const targetStair = this.stairs.find(s =>
                    s.x === this.player.x &&
                    s.y === this.player.y &&
                    s.layer === targetLayer &&
                    s.direction === (stair.direction === 'up' ? 'down' : 'up')
                );
                
                if (!targetStair) return;
                
                // 记录玩家之前位置用于鬼追踪
                const playerPrevPos = { x: this.player.x, y: this.player.y };
                const prevLayer = this.playerLayer;
                
                // 执行上下楼
                this.playerLayer = targetLayer;
                this.player.steps++;
                
                if (this.gameMode === 'death-loop') {
                    this.player.stamina--;
                }
                
                // 保存当前层数据，切换到新层
                this._saveCurrentLayerData();
                this._switchToLayer(targetLayer);
                this.currentLayer = targetLayer;
                
                // 检查鬼是否跟随上下楼
                this.handleGhostStairFollow(playerPrevPos, prevLayer, targetLayer);
                
                // 更新显示
                this.updateUIDisplays();
                this.updateLayerPanel();
                this._renderStaticLayer();
                this.draw();
                
                // 检查胜利/死亡
                if (this.endPos && this.player.x === this.endPos.x && this.player.y === this.endPos.y) {
                    this.handleWin();
                    return;
                }
                
                if (this.gameMode === 'death-loop' && this.player.stamina <= 0) {
                    this.handlePlayerDeath('stamina_depleted');
                    return;
                }
                
                if (this.checkCollisionWithGhosts()) {
                    this.handlePlayerDeath('ghost');
                    return;
                }
                
                this.recordHistory();
            }

            /**
             * 处理鬼跟随玩家上下楼梯
             */
            handleGhostStairFollow(playerPrevPos, prevLayer, targetLayer) {
                // 由于我们切换到了新层，这里的ghosts是新层的鬼
                // 我们需要找到并移动前一层的鬼
                if (this.layers[prevLayer]) {
                    const prevLayerGhosts = this.layers[prevLayer].ghosts;
                    const ghostsOnStair = prevLayerGhosts.filter(g =>
                        g.x === playerPrevPos.x && g.y === playerPrevPos.y
                    );
                    
                    // 将这些鬼移动到新层
                    for (const ghost of ghostsOnStair) {
                        // 从旧层移除
                        const idx = prevLayerGhosts.indexOf(ghost);
                        if (idx > -1) {
                            prevLayerGhosts.splice(idx, 1);
                        }
                        // 添加到新层
                        ghost.trail = []; // 清空拖尾
                        this.ghosts.push(ghost);
                    }
                }
            }

            /**
             * 移动玩家并处理移动引发的所有游戏逻辑
             * @param {number} dx - X方向的移动 (-1, 0, 1)
             * @param {number} dy - Y方向的移动 (-1, 0, 1)
             */
            movePlayer(dx, dy) {
                if (this.state !== GAME_STATES.PLAYING) return;

                // 首先检查是否按下了按钮
                const button = this.buttons.find(b => 
                    b.x === this.player.x && 
                    b.y === this.player.y && 
                    b.direction.dx === dx && 
                    b.direction.dy === dy
                );
                if (button) {
                    this.pressButton(button.letter);
                    return; // 按下按钮不移动，直接返回
                }

                const playerPrevPos = { x: this.player.x, y: this.player.y };
                const newX = this.player.x + dx;
                const newY = this.player.y + dy;

                // 1. 检查是否越界
                if (newX < 0 || newX >= this.width || newY < 0 || newY >= this.height) return;
                if (!this.activeCells[newY][newX]) return; // 新增：不能走进虚空

                // 2. 检查是否有墙阻挡
                let wall;
                if (dx === 1) wall = this.vWalls[this.player.y][this.player.x + 1];
                if (dx === -1) wall = this.vWalls[this.player.y][this.player.x];
                if (dy === 1) wall = this.hWalls[this.player.y + 1][this.player.x];
                if (dy === -1) wall = this.hWalls[this.player.y][this.player.x];

                if (wall) {
                    if (wall.type === WALL_TYPES.SOLID || wall.type === WALL_TYPES.GLASS) return;
                    if (wall.type === WALL_TYPES.ONE_WAY && (dx !== wall.direction.dx || dy !== wall.direction.dy)) return;
                    if (wall.type === WALL_TYPES.LOCKED && this.player.keys < wall.keys) return;
                    if (wall.type === WALL_TYPES.LETTER_DOOR && wall.currentState === 'closed') return; 
                    if (wall.type === WALL_TYPES.LOCKED && this.player.keys >= wall.keys) {
                        wall.type = WALL_TYPES.EMPTY;
                    }
                }

                // 3. 更新玩家状态
                this.player.trail.unshift({ x: this.player.x, y: this.player.y, timestamp: Date.now() });
                this.player.x = newX;
                this.player.y = newY;
                this.player.steps++;
                if (this.gameMode === 'death-loop') {
                    this.player.stamina--;
                }
                
                // 4. 更新UI和视野
                this.updateUIDisplays();               
                this.updateVisibility();
                this.checkItemPickup();

                // 5. 检查胜利条件
                if (this.endPos && this.player.x === this.endPos.x && this.player.y === this.endPos.y) {
                    this.handleWin();
                    return;
                }

                // 6. 检查死亡条件 (体力耗尽)
                if (this.gameMode === 'death-loop' && this.player.stamina <= 0) {
                    this.handlePlayerDeath('stamina_depleted');
                    return;
                }

                // 7. 检查是否与鬼碰撞
                if (this.checkCollisionWithGhosts()) {
                    this.handlePlayerDeath('ghost');
                    return;
                }

                // 8. 移动鬼
                this.moveGhosts(playerPrevPos);

                // 9. 再次检查鬼移动后是否与玩家碰撞
                if (this.checkCollisionWithGhosts()) {
                    this.handlePlayerDeath('ghost');
                    return;
                }
                
                // 10. 更新警告并记录历史
                this.updateProximityWarning();
                if (!this.animationFrameId) this.draw();
                this.recordHistory();
            }

            /**
             * 按下按钮，切换所有对应字母门的开关状态
             * @param {string} letter - 按下的按钮的字母
             */
            pressButton(letter) {
                let toggled = false;
                const toggleState = (wall) => {
                    if (wall.type === WALL_TYPES.LETTER_DOOR && wall.letter === letter) {
                        wall.currentState = (wall.currentState === 'closed') ? 'open' : 'closed';
                        toggled = true;
                    }
                };

                this.hWalls.forEach(row => row.forEach(toggleState));
                this.vWalls.forEach(row => row.forEach(toggleState));

                if (toggled) {
                    this.showToast(`切换了字母门 '${letter}'`, 1500);
                    this.draw(); // 状态改变，立即重绘
                }
            }

            /**
             * 检查玩家当前位置是否有物品并拾取
             */
            checkItemPickup() {
                const itemIndex = this.items.findIndex(item => item.x === this.player.x && item.y === this.player.y);
                if (itemIndex > -1) {
                    const item = this.items[itemIndex];
                    if (item.type === 'key') {
                        this.player.keys++;
                        this.showToast(`钥匙+1 (现在持有${this.player.keys}个)`, 2000, 'success');
                    }
                    this.items.splice(itemIndex, 1); // 从地图上移除物品
                    this.updateUIDisplays();
                }
            }
            
            /**
             * 将玩家位置重置到出生点
             */
            resetPlayerPos() {
                // 新增：支持自定义起点
                const start = this.customStartPos || this.startPos;
                this.player.x = start.x;
                this.player.y = start.y;
                this.player.trail = [];
            }
            
            /**
             * 更新所有UI显示，如生命、钥匙、步数等
             */
            updateUIDisplays() {
                if (this.gameMode === 'exploration') {
                    this.healthDisplay.textContent = `生命: ${this.player.hp}`;
                    this.keysDisplay.textContent = `钥匙: ${this.player.keys}`;
                    this.stepsDisplay.textContent = `步数: ${this.player.steps}`;
                } else { // death-loop
                    document.getElementById('loop-count-display').textContent = `循环次数: ${this.loopCount}`;
                    document.getElementById('player-keys-display-death-loop').textContent = `钥匙: ${this.player.keys}`;
                    document.getElementById('player-stamina-display').textContent = `剩余体力: ${this.player.stamina}`;
                }
                this.updateProximityWarning();
            }

            /**
             * 更新周围鬼数量的警告显示和背景效果
             */
            updateProximityWarning() {
                if (this.gameMode === 'death-loop') { // 死亡循环模式无此功能
                    document.body.classList.remove('danger-bg');
                    this.ghostProximityDisplay.classList.remove('warning');
                    return;
                }

                let totalNearbyGhosts = 0;
                let invisibleNearbyGhosts = 0;

                for (const ghost of this.ghosts) {
                    const isNearby = Math.abs(ghost.x - this.player.x) <= 1 && Math.abs(ghost.y - this.player.y) <= 1;
                    if (isNearby) {
                        totalNearbyGhosts++;
                        const isVisible = this.seenCells[ghost.y][ghost.x] || this.debugVision;
                        if (!isVisible) {
                            invisibleNearbyGhosts++;
                        }
                    }
                }

                this.ghostProximityDisplay.textContent = `周围鬼数: ${totalNearbyGhosts}`;

                // 如果附近有看不见的鬼，则触发警告效果
                if (invisibleNearbyGhosts > 0) {
                    document.body.classList.add('danger-bg');
                    this.ghostProximityDisplay.classList.add('warning');
                } else {
                    document.body.classList.remove('danger-bg');
                    this.ghostProximityDisplay.classList.remove('warning');
                }
            }

            // ==================================================
            //  鬼逻辑
            // ==================================================
            
            /**
             * 检查鬼是否能沿直线看到玩家（无障碍）
             * @param {object} ghost - 鬼对象
             * @param {object} playerPos - 玩家坐标 {x, y}
             * @returns {boolean} 是否能看到
             */
            canGhostSeePlayer(ghost, playerPos) {
                if (!playerPos || ghost.x !== playerPos.x && ghost.y !== playerPos.y) return false;
                
                if (ghost.x === playerPos.x) { // 垂直方向
                    const startY = Math.min(ghost.y, playerPos.y);
                    const endY = Math.max(ghost.y, playerPos.y);
                    for (let y = startY; y < endY; y++) {
                        const wall = this.hWalls[y + 1][ghost.x];
                        if ( (wall.type > 0 && wall.type !== WALL_TYPES.GLASS) &&
                             !(wall.type === WALL_TYPES.LETTER_DOOR && wall.currentState === 'open') ) {
                            return false;
                        }
                    }
                } else { // 水平方向
                    const startX = Math.min(ghost.x, playerPos.x);
                    const endX = Math.max(ghost.x, playerPos.x);
                    for (let x = startX; x < endX; x++) {
                        const wall = this.vWalls[ghost.y][x + 1];
                        if ( (wall.type > 0 && wall.type !== WALL_TYPES.GLASS) &&
                             !(wall.type === WALL_TYPES.LETTER_DOOR && wall.currentState === 'open') ) {
                            return false;
                        }
                    } 
                }
                return true;
            }

            /**
             * 移动所有鬼的逻辑
             * @param {object} playerPrevPos - 玩家移动前的位置
             */
            moveGhosts(playerPrevPos) {
                let moveIntents = [];

                // 阶段一：收集所有鬼的移动意图
                for (const ghost of this.ghosts) {
                    const sawBefore = this.canGhostSeePlayer(ghost, playerPrevPos);
                    const seesAfter = this.canGhostSeePlayer(ghost, this.player);

                    let target = null;
                    if (!sawBefore && seesAfter) target = this.player; // 玩家进入视野
                    if (sawBefore && !seesAfter) target = playerPrevPos; // 玩家离开视野
                    if (sawBefore && seesAfter) target = this.player; // 玩家在视野内移动
                    
                    if (target) {
                        const path = this.findShortestPath(ghost, target);
                        if (path && path.length > 1) {
                            moveIntents.push({ ghost: ghost, nextStep: path[1] });
                        }
                    }
                }

                if (moveIntents.length === 0) return;

                // 阶段二：解决移动冲突并执行移动
                let maxIterations = this.ghosts.length + 1; 
                let madeProgress = true;

                while (madeProgress && moveIntents.length > 0 && maxIterations > 0) {
                    madeProgress = false;
                    maxIterations--;

                    const occupiedCells = new Set(this.ghosts.map(g => `${g.x},${g.y}`));
                    let possibleMoves = [];
                    let remainingIntents = [];

                    // 筛选出目标格子当前为空的移动
                    for (const intent of moveIntents) {
                        const targetKey = `${intent.nextStep.x},${intent.nextStep.y}`;
                        if (!occupiedCells.has(targetKey)) {
                            possibleMoves.push(intent);
                        } else {
                            remainingIntents.push(intent);
                        }
                    }

                    // 解决多个鬼抢同一个格子的冲突
                    const finalMovesThisPass = [];
                    const claimedTargets = new Set();
                    for (const intent of possibleMoves) {
                        const targetKey = `${intent.nextStep.x},${intent.nextStep.y}`;
                        if (!claimedTargets.has(targetKey)) {
                            finalMovesThisPass.push(intent);
                            claimedTargets.add(targetKey);
                        } else {
                            remainingIntents.push(intent);
                        }
                    }

                    // 执行本轮确定的移动
                    if (finalMovesThisPass.length > 0) {
                        for (const { ghost, nextStep } of finalMovesThisPass) {
                            ghost.trail.unshift({ x: ghost.x, y: ghost.y, timestamp: Date.now() });
                            ghost.x = nextStep.x;
                            ghost.y = nextStep.y;
                        }
                        madeProgress = true;
                    }
                    
                    moveIntents = remainingIntents; // 继续处理未解决的移动意图
                }
            }
            
            /**
             * 检查指定坐标是否被其他鬼占据
             * @param {number} x - X坐标
             * @param {number} y - Y坐标
             * @param {number} selfId - 要排除的鬼的ID
             * @returns {boolean} 是否被占据
             */
            isCellOccupiedByGhost(x, y, selfId = -1) {
                return this.ghosts.some(g => g.id !== selfId && g.x === x && g.y === y);
            }

            // ==================================================
            //  游戏结束与浮窗
            // ==================================================
            
            /**
             * 检查玩家是否与任何一个鬼在同一个格子上
             * @returns {boolean} 是否发生碰撞
             */
            checkCollisionWithGhosts() {
                return this.ghosts.some(g => g.x === this.player.x && g.y === this.player.y);
            }

            /**
             * 处理玩家死亡事件
             * @param {string} reason - 死亡原因 ('ghost', 'stamina_depleted')
             */
            handlePlayerDeath(reason = 'ghost') {
                this.stopAutoMove();
                this.stopAnimationLoop();
                this.state = GAME_STATES.DEAD;
                
                if (this.gameMode === 'exploration') {
                    this.player.hp--;
                    this.updateUIDisplays();
                    this.draw();
                    if (this.player.hp > 0) { // 还有生命值，可以复活
                        document.getElementById('death-message').textContent = `你死了 (剩余血量 ${this.player.hp})`;
                        document.getElementById('revive-btn').textContent = '复活';
                        document.getElementById('death-overlay').style.display = 'flex';
                    } else { // 生命值耗尽，游戏结束
                        document.getElementById('game-over-overlay').style.display = 'flex';
                    }
                } else { // 死亡循环模式
                    this.draw();
                    const message = reason === 'stamina_depleted' ? '体力耗尽，你死了' : '你死了';
                    document.getElementById('death-message').textContent = message;
                    document.getElementById('revive-btn').textContent = '复活';
                    document.getElementById('death-overlay').style.display = 'flex';
                }
            }
            
            /**
             * 处理玩家复活逻辑
             */
            revivePlayer() {
                if (this.gameMode === 'exploration') {
                    this.resetPlayerPos();
                    this.state = GAME_STATES.PLAYING;
                    this.hideAllOverlays();
                    this.updateVisibility();
                    this.updateProximityWarning();
                    this.startAnimationLoop();
                    this.recordHistory(true); // 记录一个复活点
                } else { // 死亡循环模式
                    this.loopCount++;
                    this.state = GAME_STATES.PLAYING;
                    this.hideAllOverlays();

                    // 重置玩家和地图状态，但保留已探索的视野
                    this.resetPlayerPos();
                    this.player.keys = 0;
                    this.player.steps = 0;
                    this.player.stamina = this.initialStamina;
                    
                    // 从原始地图数据中重置物品和鬼
                    this.items = JSON.parse(JSON.stringify(this.mapData.items || []));
                    this.ghosts = JSON.parse(JSON.stringify(this.mapData.initialGhosts));
                    this.hWalls = JSON.parse(JSON.stringify(this.mapData.hWalls)); 
                    this.vWalls = JSON.parse(JSON.stringify(this.mapData.vWalls));
                    this.ghosts.forEach(g => g.trail = []); // 初始化拖尾数组

                    // 重置所有字母门的当前状态
                    this.hWalls.forEach(row => row.forEach(wall => {
                        if (wall.type === WALL_TYPES.LETTER_DOOR) {
                            wall.currentState = wall.initialState || 'closed';
                        }
                    }));
                    this.vWalls.forEach(row => row.forEach(wall => {
                        if (wall.type === WALL_TYPES.LETTER_DOOR) {
                            wall.currentState = wall.initialState || 'closed';
                        }
                    }));

                    this.updateVisibility();
                    this.updateUIDisplays();
                    this.startAnimationLoop();
                    this.recordHistory(true); // 记录一个复活点
                }
            }

            /**
             * 处理游戏胜利逻辑
             */
            handleWin() {
                this.stopAutoMove();
                this.stopAnimationLoop();
                this.state = GAME_STATES.WON;

                const winStats = document.getElementById('win-stats');
                if (this.gameMode === 'exploration') {
                    winStats.textContent = `你以 ${this.player.hp} 点剩余生命和 ${this.player.steps} 步的成绩通关！`;
                } else { // death-loop
                    winStats.textContent = `你以 ${this.loopCount} 次循环和 ${this.player.stamina} 点剩余体力的成绩通关！`;
                }

                document.getElementById('win-overlay').style.display = 'flex';
            }
            
            /**
             * 隐藏所有游戏状态浮窗
             */
            hideAllOverlays() {
                document.getElementById('death-overlay').style.display = 'none';
                document.getElementById('game-over-overlay').style.display = 'none';
                document.getElementById('win-overlay').style.display = 'none';
            }

            // ==================================================
            //  视野系统
            // ==================================================

            /**
             * 根据玩家当前位置更新可见的单元格
             */
            updateVisibility() {
                // 新增：自由模式下，没有固定起始房间，只显示起点
                if (this.editor.mode === 'regular') {
                    const roomY = this.height - 3;
                    for (let y = roomY; y < roomY + 3; y++) {
                        for (let x = 0; x < 3; x++) {
                            this.seenCells[y][x] = true;
                        }
                    }
                } else {
                     const start = this.customStartPos || this.startPos;
                     if(start) this.seenCells[start.y][start.x] = true;
                }

                const { x, y } = this.player;
                this.seenCells[y][x] = true; // 玩家当前格子可见

                // 沿四个方向进行“射线投射”，直到遇到非玻璃墙
                for (let i = x + 1; i < this.width; i++) {
                    if(!this.activeCells[y][i]) break; // 遇到虚空停止
                    const wall = this.vWalls[y][i];
                    if (wall.type > 0 && wall.type !== WALL_TYPES.GLASS) break;
                    this.seenCells[y][i] = true;
                }
                for (let i = x - 1; i >= 0; i--) {
                    if(!this.activeCells[y][i]) break; // 遇到虚空停止
                    const wall = this.vWalls[y][i + 1];
                    if (wall.type > 0 && wall.type !== WALL_TYPES.GLASS) break;
                    this.seenCells[y][i] = true;
                }
                for (let i = y + 1; i < this.height; i++) {
                    if(!this.activeCells[i][x]) break; // 遇到虚空停止
                    const wall = this.hWalls[i][x];
                    if (wall.type > 0 && wall.type !== WALL_TYPES.GLASS) break;
                    this.seenCells[i][x] = true;
                }
                for (let i = y - 1; i >= 0; i--) {
                    if(!this.activeCells[i][x]) break; // 遇到虚空停止
                    const wall = this.hWalls[i + 1][x];
                    if (wall.type > 0 && wall.type !== WALL_TYPES.GLASS) break;
                    this.seenCells[i][x] = true;
                }
            }

            // ==================================================
            //  渲染
            // ==================================================

            /**
             * [私有] 渲染静态背景层（地面、网格线）到离屏Canvas
             */
            _renderStaticLayer() {
                this.staticLayerCanvas.width = canvas.width;
                this.staticLayerCanvas.height = canvas.height;
                const ctx = this.staticLayerCtx;
                const cs = this.cellSize;

                ctx.clearRect(0, 0, canvas.width, canvas.height);

                // 绘制地面
                for (let y = 0; y < this.height; y++) {
                    for (let x = 0; x < this.width; x++) {
                        if (this.activeCells[y][x]) {
                            ctx.fillStyle = this.colors.ground;
                            ctx.fillRect(x * cs, y * cs, cs, cs);
                            // 绘制网格线
                            ctx.strokeStyle = this.colors.gridLine;
                            ctx.lineWidth = 1;
                            ctx.strokeRect(x * cs, y * cs, cs, cs);
                        } else if (this.state === GAME_STATES.EDITOR) {
                            // 编辑器显示虚空网格
                            ctx.fillStyle = "rgba(0,0,0,0)";
                            ctx.strokeStyle = this.colors.voidGrid;
                            ctx.lineWidth = 0.5;
                            ctx.setLineDash([2, 2]);
                            ctx.strokeRect(x * cs, y * cs, cs, cs);
                            ctx.setLineDash([]);
                        }
                    }
                }
            }

            /**
             * 绘制墙角填充块，解决线条连接处的凹陷问题
             * @param {boolean} isEditor - 是否为编辑器模式
             */
            drawCorners(isEditor = false) {
                const cs = this.cellSize;
                const w = Math.max(2, cs / 10); // 与墙体宽度保持一致

                ctx.fillStyle = this.colors.wall;

                // 辅助函数：判断某点(x,y)在指定方向是否应该有视觉上的线条（实体墙 或 虚空边界）
                const hasVisualLine = (type, wx, wy) => {
                    // 1. 检查是否有实体墙
                    if (type === 'h') {
                        if (wx < 0 || wx >= this.width) return false;
                        if (this.hWalls[wy][wx].type > 0) return true;
                    } else { // type === 'v'
                        if (wy < 0 || wy >= this.height) return false;
                        if (this.vWalls[wy][wx].type > 0) return true;
                    }
                    
                    // 2. 检查是否是虚空边界 (Active vs Void)
                    // 边界定义：线两侧的状态不一样 (一个Active一个Void，或者一个In-Bounds一个Out-Bounds)
                    const isActive = (cx, cy) => {
                        if (cx < 0 || cx >= this.width || cy < 0 || cy >= this.height) return false;
                        return this.activeCells[cy][cx];
                    };

                    if (type === 'h') {
                        const up = isActive(wx, wy - 1);
                        const down = isActive(wx, wy);
                        return up !== down;
                    } else { // type === 'v'
                        const left = isActive(wx - 1, wy);
                        const right = isActive(wx, wy);
                        return left !== right;
                    }
                };

                for (let y = 0; y <= this.height; y++) {
                    for (let x = 0; x <= this.width; x++) {
                        // 检查四个方向是否有“视觉线条”连接到该点
                        const hasHLeft = hasVisualLine('h', x - 1, y);
                        const hasHRight = hasVisualLine('h', x, y);
                        const hasVUp = hasVisualLine('v', x, y - 1);
                        const hasVDown = hasVisualLine('v', x, y);

                        const connectedCount = (hasHLeft ? 1 : 0) + (hasHRight ? 1 : 0) + (hasVUp ? 1 : 0) + (hasVDown ? 1 : 0);
                        if (connectedCount < 2) continue;

                        // 游戏模式下的视野检查：只要该点涉及的任何一堵墙是边缘墙，或者周围有可见区域，就显示
                        if (!isEditor && !this.debugVision) {
                            // 简单的视野检查：如果拐角所在的四个格子没有一个被探索过，且不是边缘，则隐藏
                            // 但根据需求“边缘墙必须全部显示”，我们需要放宽条件
                            
                            // 重新使用 hasVisualLine 判断该点是否连接着“边界”，如果是边界连接点，强制显示
                            const isBoundaryPoint = hasVisualLine('h', x - 1, y) || hasVisualLine('h', x, y) || hasVisualLine('v', x, y - 1) || hasVisualLine('v', x, y);
                            
                            // 如果不是强制显示的边界点，再检查Fog
                            // 这里简化处理：因为上面的 hasVisualLine 已经包含了边界判断，
                            // 如果 connectedCount >= 2 且包含了边界线，它自然应该显示。
                            // 我们只需要过滤掉那些“纯内部墙且未探索”的拐角。
                            
                            const cTL = (x > 0 && y > 0 && this.seenCells[y - 1][x - 1]);
                            const cTR = (x < this.width && y > 0 && this.seenCells[y - 1][x]);
                            const cBL = (x > 0 && y < this.height && this.seenCells[y][x - 1]);
                            const cBR = (x < this.width && y < this.height && this.seenCells[y][x]);

                            // 如果是纯内部点（周围全是Active），且不可见，则跳过
                            // 这里的逻辑反过来想：如果它处于Void边缘，它肯定会被绘制
                            const isPureInternal = (x>0 && x<this.width && y>0 && y<this.height && 
                                                    this.activeCells[y-1][x-1] && this.activeCells[y-1][x] && 
                                                    this.activeCells[y][x-1] && this.activeCells[y][x]);

                            if (isPureInternal && !cTL && !cTR && !cBL && !cBR) continue;
                        }

                        // 绘制中心正方形
                        ctx.fillRect(x * cs - w / 2, y * cs - w / 2, w, w);
                    }
                }
            }

            /**
             * 主渲染函数 (修改：实现虚空透明和边界墙切割)
             */
            draw() {
                if (this.state === GAME_STATES.MENU) return;
                if (this.editor.active) {
                    this.drawEditor();
                    return;
                }

                ctx.clearRect(0, 0, canvas.width, canvas.height);
                
                ctx.save();
                ctx.translate(this.drawOffset.x, this.drawOffset.y);
                
                const cs = this.cellSize;
                const now = Date.now();

                // 1. Static Layer (Ground & Grid)
                ctx.drawImage(this.staticLayerCanvas, 0, 0);

                // 2. Trail
                const drawTrail = (arr, color) => arr.forEach(p => {
                    if (this.seenCells[p.y][p.x] || this.debugVision) {
                        const age = now - p.timestamp;
                        const alpha = 0.3 * (1 - age / 500);
                        this.drawCircle(p.x, p.y, color, alpha);
                    }
                });
                drawTrail(this.player.trail, this.colors.player);
                this.ghosts.forEach(ghost => drawTrail(ghost.trail, this.colors.ghost));

                // 3. Fog of War
                for (let y = 0; y < this.height; y++) {
                    for (let x = 0; x < this.width; x++) {
                        if (this.activeCells[y][x] && !this.seenCells[y][x] && !this.debugVision) {
                            ctx.fillStyle = this.colors.unexplored;
                            ctx.fillRect(x * cs, y * cs, cs, cs);
                        }
                    }
                }

                // 4. Walls
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

                // 绘制横墙
                for (let y = 0; y <= this.height; y++) {
                    for (let x = 0; x < this.width; x++) {
                        const isBoundary = shouldDrawBoundary(x, y, true);
                        const isActiveRow = (y < this.height && this.activeCells[y][x]) || (y > 0 && this.activeCells[y-1][x]);
                        
                        if (!isActiveRow && !isBoundary) continue;

                        // 可见性：如果是边界墙，强制显示；否则按FOV逻辑
                        const isVisible = isBoundary || this.debugVision || 
                            (y < this.height && this.activeCells[y][x] && this.seenCells[y][x]) || 
                            (y > 0 && this.activeCells[y-1][x] && this.seenCells[y-1][x]);

                        if (isVisible) {
                            if (this.hWalls[y][x].type > 0) this.drawWallOrDoor(x*cs, y*cs, (x+1)*cs, y*cs, this.hWalls[y][x]);
                            else if (isBoundary) this.drawWallOrDoor(x*cs, y*cs, (x+1)*cs, y*cs, {type:1});
                        }
                    }
                }
                // 绘制竖墙
                for (let y = 0; y < this.height; y++) {
                    for (let x = 0; x <= this.width; x++) {
                        const isBoundary = shouldDrawBoundary(x, y, false);
                        const isActiveCol = (x < this.width && this.activeCells[y][x]) || (x > 0 && this.activeCells[y][x-1]);
                        
                        if (!isActiveCol && !isBoundary) continue;

                        const isVisible = isBoundary || this.debugVision || 
                            (x < this.width && this.activeCells[y][x] && this.seenCells[y][x]) || 
                            (x > 0 && this.activeCells[y][x-1] && this.seenCells[y][x-1]);

                        if (isVisible) {
                            if (this.vWalls[y][x].type > 0) this.drawWallOrDoor(x*cs, y*cs, x*cs, (y+1)*cs, this.vWalls[y][x]);
                            else if (isBoundary) this.drawWallOrDoor(x*cs, y*cs, x*cs, (y+1)*cs, {type:1});
                        }
                    }
                }
                ctx.stroke();
                
                // 5. 绘制墙角填充
                this.drawCorners(false);

                // 5.5 绘制楼梯（在其他实体之前，最底层）
                this.stairs.filter(s => s.layer === this.currentLayer).forEach(stair => {
                    if (this.seenCells[stair.y][stair.x] || this.debugVision) {
                        this.drawStair(stair);
                    }
                });

                // 6. Entities
                if (this.endPos && (this.seenCells[this.endPos.y][this.endPos.x] || this.debugVision)) {
                    this.drawCircle(this.endPos.x, this.endPos.y, this.colors.endPoint);
                }
                this.ghosts.forEach(ghost => {
                    if (this.seenCells[ghost.y][ghost.x] || this.debugVision) {
                        this.drawCircle(ghost.x, ghost.y, this.colors.ghost);
                    }
                });
                this.drawCircle(this.player.x, this.player.y, this.colors.player);
                this.items.forEach(item => {
                    if (this.seenCells[item.y][item.x] || this.debugVision) {
                        this.drawItem(item);
                    }
                });
                this.buttons.forEach(button => {
                    if (this.seenCells[button.y][button.x] || this.debugVision) {
                        this.drawButton(button);
                    }
                });
                this.drawWallOverlays(true);
                
                ctx.restore();
            }

            /**
             * 渲染编辑器界面 (修改：实现虚空透明、边界切割，并统一颜色)
             */
            drawEditor() {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                
                ctx.save(); // 保存状态以便应用偏移
                ctx.translate(this.padding || 0, this.padding || 0); // 应用内边距偏移

                const cs = this.cellSize;

                // 1. 静态层 (地面)
                ctx.drawImage(this.staticLayerCanvas, 0, 0);

                // 起始房间高亮 (常规模式)
                if (this.editor.mode === 'regular') {
                    ctx.fillStyle = this.colors.startRoomHighlight;
                    ctx.fillRect(0, (this.height - 3) * cs, 3 * cs, 3 * cs);
                }
                
                // 2. 墙壁绘制
                ctx.beginPath();
                const shouldDrawBoundary = (bx, by, isH) => {
                    if (isH) {
                        const up = (by > 0) ? this.activeCells[by-1][bx] : false;
                        const down = (by < this.height) ? this.activeCells[by][bx] : false;
                        return up !== down;
                    } else {
                        const left = (bx > 0) ? this.activeCells[by][bx-1] : false;
                        const right = (bx < this.width) ? this.activeCells[by][bx] : false;
                        return left !== right;
                    }
                };

                for (let y = 0; y <= this.height; y++) {
                    for (let x = 0; x < this.width; x++) {
                        const isActiveRow = (y < this.height && this.activeCells[y][x]) || (y > 0 && this.activeCells[y-1][x]);
                        if (!isActiveRow) continue;

                        if (this.hWalls[y][x].type > 0) this.drawWallOrDoor(x * cs, y * cs, (x + 1) * cs, y * cs, this.hWalls[y][x]);
                        else if (this.editor.mode === 'free' && shouldDrawBoundary(x, y, true)) this.drawWallOrDoor(x * cs, y * cs, (x + 1) * cs, y * cs, {type:1});
                    }
                }
                for (let y = 0; y < this.height; y++) {
                    for (let x = 0; x <= this.width; x++) {
                        const isActiveCol = (x < this.width && this.activeCells[y][x]) || (x > 0 && this.activeCells[y][x-1]);
                        if (!isActiveCol) continue;

                        if (this.vWalls[y][x].type > 0) this.drawWallOrDoor(x * cs, y * cs, x * cs, (y + 1) * cs, this.vWalls[y][x]);
                        else if (this.editor.mode === 'free' && shouldDrawBoundary(x, y, false)) this.drawWallOrDoor(x * cs, y * cs, x * cs, (y + 1) * cs, {type:1});
                    }
                }
                ctx.stroke();
                
                // === 核心修改：编辑器中的虚空擦除与网格重绘 ===
                // 先擦除虚空区域，实现边界墙的切割效果
                for(let y=0; y<this.height; y++) {
                    for(let x=0; x<this.width; x++) {
                        if(!this.activeCells[y][x]) {
                            ctx.clearRect(x*cs, y*cs, cs, cs);
                        }
                    }
                }

                // 再在虚空区域补画虚线网格 (仅自由模式)
                if (this.editor.mode === 'free') {
                    ctx.beginPath();
                    ctx.strokeStyle = this.colors.voidGrid;
                    ctx.lineWidth = 1;
                    ctx.setLineDash([5, 5]);
                    
                    // 绘制虚空格子
                    for(let y=0; y<this.height; y++) {
                        for(let x=0; x<this.width; x++) {
                            if(!this.activeCells[y][x]) {
                                ctx.strokeRect(x*cs, y*cs, cs, cs);
                            }
                        }
                    }
                    // 绘制最大边界框
                    ctx.strokeRect(0, 0, this.width * cs, this.height * cs);
                    ctx.setLineDash([]);
                }

                this.drawWallOverlays();
                
                // 鼠标悬停高亮
                if (this.editor.tool === EDITOR_TOOLS.GRID && this.editor.hoveredWall && !this.editor.isDragging) {
                    const {x, y} = this.editor.hoveredWall;
                    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
                        ctx.fillStyle = "rgba(255, 255, 0, 0.3)";
                        ctx.fillRect(x * cs, y * cs, cs, cs);
                    }
                } else if (this.editor.hoveredWall && !this.editor.isDragging && this.editor.tool !== EDITOR_TOOLS.ERASER) {
                    const {x, y, type, direction} = this.editor.hoveredWall;
                    let wallType = 1;
                    switch(this.editor.tool) {
                        case EDITOR_TOOLS.DOOR: wallType=2; break; case EDITOR_TOOLS.GLASS: wallType=5; break; case EDITOR_TOOLS.LOCK: wallType=3; break; case EDITOR_TOOLS.ONE_WAY: wallType=4; break; case EDITOR_TOOLS.LETTER_DOOR: wallType=6; break; default: wallType=1;
                    }
                    const isValidWall = (type==='h') 
                        ? (y>0 && this.activeCells[y-1][x]) || (y<this.height && this.activeCells[y][x])
                        : (x>0 && this.activeCells[y][x-1]) || (x<this.width && this.activeCells[y][x]);

                    if (isValidWall) {
                         ctx.beginPath();
                         const wallObject = { type: wallType, keys: '?', direction: direction };
                         if (type === 'h') this.drawWallOrDoor(x * cs, y * cs, (x + 1) * cs, y * cs, wallObject, true);
                         else this.drawWallOrDoor(x * cs, y * cs, x * cs, (y + 1) * cs, wallObject, true);
                         ctx.stroke();

                         if (wallObject.type === WALL_TYPES.ONE_WAY && wallObject.direction) {
                            if (type === 'h') {
                                this.drawArrow(x * cs, y * cs, (x + 1) * cs, y * cs, direction, 'white', false);
                            } else {
                                this.drawArrow(x * cs, y * cs, x * cs, (y + 1) * cs, direction, 'white', false);
                            }
                        }
                    }
                }

               // 绘制实体
                this.items.forEach(item => this.drawItem(item));
                if (this.endPos) this.drawCircle(this.endPos.x, this.endPos.y, this.colors.endPoint);
                
                // 修改：自由模式起点使用玩家颜色
                if (this.customStartPos) this.drawCircle(this.customStartPos.x, this.customStartPos.y, this.colors.player); 
                
                this.ghosts.forEach(g => this.drawCircle(g.x, g.y, this.colors.ghost));
                this.buttons.forEach(b => this.drawButton(b));
                
                if (this.editor.mode === 'regular') this.drawCircle(this.startPos.x, this.startPos.y, this.colors.player);

                if (this.editor.hoveredButtonHotspot) {
                    const virtualButton = {
                        x: this.editor.hoveredButtonHotspot.x,
                        y: this.editor.hoveredButtonHotspot.y,
                        direction: this.editor.hoveredButtonHotspot.direction
                    };
                    this.drawButton(virtualButton, true);
                }              
                ctx.restore(); // 恢复画布状态
            }

            /**
             * 绘制单面墙或门
             * @param {number} x1 - 起点X
             * @param {number} y1 - 起点Y
             * @param {number} x2 - 终点X
             * @param {number} y2 - 终点Y
             * @param {object} wallObject - 墙体数据对象
             * @param {boolean} isHighlight - 是否高亮显示
             */
            drawWallOrDoor(x1, y1, x2, y2, wallObject, isHighlight = false) {
                const type = wallObject.type;
                const cs = this.cellSize;

                if (isHighlight) {
                    ctx.strokeStyle = this.colors.hoverHighlight;
                    ctx.lineWidth = Math.max(3, cs / 8);
                } else {
                    ctx.strokeStyle = this.colors.wall;
                    if ([WALL_TYPES.SOLID, WALL_TYPES.DOOR, WALL_TYPES.GLASS].includes(type)) {
                        ctx.lineWidth = Math.max(2, cs / 10);
                    } else if ([WALL_TYPES.LOCKED, WALL_TYPES.ONE_WAY].includes(type)) {
                        ctx.lineWidth = Math.max(3, cs / 12); 
                    }
                }
                
                if (type === WALL_TYPES.SOLID) {
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x2, y2);
                } else if (type === WALL_TYPES.GLASS) {
                    const isHorizontal = y1 === y2;
                    const lineLength = cs * 0.2;
                    const offset = lineLength / 2;
                    const points = [
                        { x: x1 * 5/6 + x2 * 1/6, y: y1 * 5/6 + y2 * 1/6 },
                        { x: (x1 + x2) / 2, y: (y1 + y2) / 2 },
                        { x: x1 * 1/6 + x2 * 5/6, y: y1 * 1/6 + y2 * 5/6 }
                    ];
                    for (const p of points) {
                        if (isHorizontal) {
                            ctx.moveTo(p.x - offset, p.y + offset);
                            ctx.lineTo(p.x + offset, p.y - offset);
                        } else {
                            ctx.moveTo(p.x - offset, p.y + offset);
                            ctx.lineTo(p.x + offset, p.y - offset);
                        }
                    }
                } else if (type === WALL_TYPES.LOCKED || type === WALL_TYPES.ONE_WAY || type === WALL_TYPES.LETTER_DOOR) {
                    // 根据当前是游戏还是编辑器，来决定字母门是否渲染为开启状态
                    let isLetterDoorOpen = false;
                    if (type === WALL_TYPES.LETTER_DOOR) {
                        // 将所有非编辑器状态（playing, dead, won）都视为游戏内状态
                        if (this.state === GAME_STATES.EDITOR) {
                            // 在编辑器中，使用初始状态
                            isLetterDoorOpen = wallObject.initialState === 'open';
                        } else {
                            // 在所有其他游戏相关状态中，使用当前状态
                            isLetterDoorOpen = wallObject.currentState === 'open';
                        }
                    }

                    // 如果判定为开启，则不绘制门框
                    if (isLetterDoorOpen) {
                        return;
                    }

                    const isHorizontal = y1 === y2;
                    const lockWidth = cs * 0.2;
                    if (isHorizontal) {
                        ctx.rect(x1, y1 - lockWidth / 2, cs, lockWidth);
                    } else {
                        ctx.rect(x1 - lockWidth / 2, y1, lockWidth, cs);
                    }
                } else if (type === WALL_TYPES.DOOR) {
                    const isHorizontal = y1 === y2;
                    const length = isHorizontal ? x2 - x1 : y2 - y1;
                    const gap = length / 3;
                    if (isHorizontal) {
                        ctx.moveTo(x1, y1); ctx.lineTo(x1 + gap, y1);
                        ctx.moveTo(x2 - gap, y2); ctx.lineTo(x2, y2);
                    } else {
                        ctx.moveTo(x1, y1); ctx.lineTo(x1, y1 + gap);
                        ctx.moveTo(x2, y2 - gap); ctx.lineTo(x2, y2);
                    }
                }
            }

            /**
             * 在墙体中心绘制一个表示方向的箭头
             * @param {number} x1 - 墙体起点X
             * @param {number} y1 - 墙体起点Y
             * @param {number} x2 - 墙体终点X
             * @param {number} y2 - 墙体终点Y
             * @param {object} direction - 方向对象 {dx, dy}
             * @param {string} color - 箭头颜色
             * @param {boolean} withStroke - 是否带描边
             */
            drawArrow(x1, y1, x2, y2, direction, color, withStroke) {
                const centerX = (x1 + x2) / 2;
                const centerY = (y1 + y2) / 2;
                const cs = this.cellSize;
                const fontSize = cs * 0.6; 

                ctx.save(); // 保存画布状态
                ctx.translate(centerX, centerY); // 移动原点到墙中心

                // 根据方向旋转画布
                if (direction.dx === 1) { ctx.rotate(0); } 
                else if (direction.dx === -1) { ctx.rotate(Math.PI); } 
                else if (direction.dy === 1) { ctx.rotate(Math.PI / 2); } 
                else if (direction.dy === -1) { ctx.rotate(-Math.PI / 2); }

                ctx.scale(0.8, 1.0); // 稍微压扁箭头

                ctx.font = `bold ${fontSize}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                if (withStroke) {
                    ctx.strokeStyle = 'black';
                    ctx.lineWidth = 3;
                    ctx.strokeText('>', 0, 0);
                }
                ctx.fillStyle = color;
                ctx.fillText('>', 0, 0);

                ctx.restore(); // 恢复画布状态
            }

            /**
             * 绘制所有墙体上的覆盖物，如数字门的数字和单向门的箭头
             * @param {boolean} inGame - 是否在游戏模式下调用
             */
            drawWallOverlays(inGame = false) {
                const cs = this.cellSize;
                
                const drawNumber = (x1, y1, x2, y2, number) => {
                    const centerX = (x1 + x2) / 2;
                    const centerY = (y1 + y2) / 2;
                    const fontSize = this.cellSize * 0.4;
                    const text = number.toString();
                    ctx.font = `bold ${fontSize}px sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.strokeStyle = 'black';
                    ctx.lineWidth = 3;
                    ctx.strokeText(text, centerX, centerY);
                    ctx.fillStyle = this.colors.key;
                    ctx.fillText(text, centerX, centerY);
                };

                // 遍历水平墙
                for (let y = 1; y < this.height; y++) {
                    for (let x = 0; x < this.width; x++) {
                        const w = this.hWalls[y][x];
                        // 新增：检查activeCells
                        const isActiveRow = this.activeCells[y][x] && this.activeCells[y-1][x];
                        if (!isActiveRow) continue;

                        const isVisible = !inGame || this.debugVision || this.seenCells[y - 1][x] || this.seenCells[y][x];
                        if (isVisible) {
                            if (w.type === WALL_TYPES.LOCKED) {
                                drawNumber(x * cs, y * cs, (x + 1) * cs, y * cs, w.keys);
                            } else if (w.type === WALL_TYPES.LETTER_DOOR) {
                                drawNumber(x * cs, y * cs, (x + 1) * cs, y * cs, w.letter);
                            } else if (w.type === WALL_TYPES.ONE_WAY && w.direction) {
                                this.drawArrow(x * cs, y * cs, (x + 1) * cs, y * cs, w.direction, this.colors.key, true);
                            }
                        }
                    }
                }

                // 遍历垂直墙
                for (let y = 0; y < this.height; y++) {
                    for (let x = 1; x < this.width; x++) {
                        const w = this.vWalls[y][x];
                        // 新增：检查activeCells
                        const isActiveCol = this.activeCells[y][x] && this.activeCells[y][x-1];
                        if (!isActiveCol) continue;

                        const isVisible = !inGame || this.debugVision || this.seenCells[y][x - 1] || this.seenCells[y][x];
                        if (isVisible) {
                            if (w.type === WALL_TYPES.LOCKED) {
                                drawNumber(x * cs, y * cs, x * cs, (y + 1) * cs, w.keys);
                            } else if (w.type === WALL_TYPES.LETTER_DOOR) {
                                drawNumber(x * cs, y * cs, x * cs, (y + 1) * cs, w.letter);
                            } else if (w.type === WALL_TYPES.ONE_WAY && w.direction) {
                                this.drawArrow(x * cs, y * cs, x * cs, (y + 1) * cs, w.direction, this.colors.key, true);
                            }
                        }
                    }
                }
            }

            /**
             * 在指定格子绘制一个圆形，用于玩家、鬼和终点
             * @param {number} x - 格子X坐标
             * @param {number} y - 格子Y坐标
             * @param {string} color - 颜色
             * @param {number} alpha - 透明度
             */
            drawCircle(x, y, color, alpha = 1.0) {
                if (alpha <= 0) return;
                const cs = this.cellSize;
                ctx.globalAlpha = alpha;
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(x * cs + cs / 2, y * cs + cs / 2, cs * 0.35, 0, 2 * Math.PI);
                ctx.fill();
                ctx.globalAlpha = 1.0;
            }

            /**
             * 绘制物品，如钥匙
             * @param {object} item - 物品对象
             */
            drawItem(item) {
                if (item.type === 'key') {
                    const cs = this.cellSize;
                    const centerX = item.x * cs + cs / 2;
                    const centerY = item.y * cs + cs / 2;
                    const size = cs * 0.3;
                    ctx.fillStyle = this.colors.key;
                    ctx.beginPath();
                    ctx.moveTo(centerX, centerY - size);
                    ctx.lineTo(centerX + size, centerY);
                    ctx.lineTo(centerX, centerY + size);
                    ctx.lineTo(centerX - size, centerY);
                    ctx.closePath();
                    ctx.fill();
                }
            }

            /**
             * 绘制楼梯
             * @param {object} stair - 楼梯对象 {x, y, direction: 'up'|'down'}
             * @param {boolean} isHighlight - 是否高亮显示
             * @param {number} alpha - 透明度
             */
            drawStair(stair, isHighlight = false, alpha = 1.0) {
                const cs = this.cellSize;
                const x = stair.x * cs;
                const y = stair.y * cs;
                const padding = cs * 0.1;
                const stepHeight = (cs - 2 * padding) / 3;
                const stepWidth = (cs - 2 * padding) / 3;
                
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = isHighlight ? this.colors.hoverHighlight : this.colors.wall;
                ctx.lineWidth = Math.max(2, cs / 15);
                ctx.beginPath();
                
                if (stair.direction === 'up') {
                    // 向上楼梯：左低右高（三级台阶）
                    // 左边框
                    ctx.moveTo(x + padding, y + cs - padding);
                    ctx.lineTo(x + padding, y + cs - padding - stepHeight);
                    // 第一级台阶
                    ctx.lineTo(x + padding + stepWidth, y + cs - padding - stepHeight);
                    ctx.lineTo(x + padding + stepWidth, y + cs - padding - 2 * stepHeight);
                    // 第二级台阶
                    ctx.lineTo(x + padding + 2 * stepWidth, y + cs - padding - 2 * stepHeight);
                    ctx.lineTo(x + padding + 2 * stepWidth, y + cs - padding - 3 * stepHeight);
                    // 第三级台阶顶部
                    ctx.lineTo(x + cs - padding, y + padding);
                    // 右边框
                    ctx.lineTo(x + cs - padding, y + cs - padding);
                    // 底部
                    ctx.lineTo(x + padding, y + cs - padding);
                } else {
                    // 向下楼梯：左高右低（三级台阶）
                    // 左边框
                    ctx.moveTo(x + padding, y + cs - padding);
                    ctx.lineTo(x + padding, y + padding);
                    // 顶部到第一级台阶
                    ctx.lineTo(x + padding + stepWidth, y + padding);
                    ctx.lineTo(x + padding + stepWidth, y + padding + stepHeight);
                    // 第二级台阶
                    ctx.lineTo(x + padding + 2 * stepWidth, y + padding + stepHeight);
                    ctx.lineTo(x + padding + 2 * stepWidth, y + padding + 2 * stepHeight);
                    // 第三级台阶
                    ctx.lineTo(x + cs - padding, y + padding + 2 * stepHeight);
                    ctx.lineTo(x + cs - padding, y + cs - padding);
                    // 底部
                    ctx.lineTo(x + padding, y + cs - padding);
                }
                
                ctx.stroke();
                ctx.restore();
            }

            /**
             * 绘制一个按钮
             * @param {object} button - 按钮对象
             * @param {boolean} isHighlight - 是否为高亮预览模式
             */
            drawButton(button, isHighlight = false) {
                const cs = this.cellSize;
                const centerX = button.x * cs + cs / 2;
                const centerY = button.y * cs + cs / 2;
                
                const buttonLength = cs * 0.5;
                const buttonWidth = cs * 0.2;

                let p1, p2, p3, p4;
                let letterCenterX, letterCenterY;

                // ... (坐标计算的 switch 语句保持不变) ...
                switch (true) {
                    case button.direction.dy === -1: // 依附在上方墙体
                        p1 = { x: centerX - buttonLength / 2, y: button.y * cs };
                        p2 = { x: centerX + buttonLength / 2, y: button.y * cs };
                        p3 = { x: centerX + buttonLength / 2, y: button.y * cs + buttonWidth };
                        p4 = { x: centerX - buttonLength / 2, y: button.y * cs + buttonWidth };
                        letterCenterX = centerX; letterCenterY = p1.y + buttonWidth / 2;
                        break;
                    case button.direction.dy === 1: // 依附在下方墙体
                        p1 = { x: centerX - buttonLength / 2, y: (button.y + 1) * cs - buttonWidth };
                        p2 = { x: centerX + buttonLength / 2, y: (button.y + 1) * cs - buttonWidth };
                        p3 = { x: centerX + buttonLength / 2, y: (button.y + 1) * cs };
                        p4 = { x: centerX - buttonLength / 2, y: (button.y + 1) * cs };
                        letterCenterX = centerX; letterCenterY = p1.y + buttonWidth / 2;
                        break;
                    case button.direction.dx === -1: // 依附在左方墙体
                        p1 = { x: button.x * cs, y: centerY - buttonLength / 2 };
                        p2 = { x: button.x * cs + buttonWidth, y: centerY - buttonLength / 2 };
                        p3 = { x: button.x * cs + buttonWidth, y: centerY + buttonLength / 2 };
                        p4 = { x: button.x * cs, y: centerY + buttonLength / 2 };
                        letterCenterX = p1.x + buttonWidth / 2; letterCenterY = centerY;
                        break;
                    case button.direction.dx === 1: // 依附在右方墙体
                        p1 = { x: (button.x + 1) * cs - buttonWidth, y: centerY - buttonLength / 2 };
                        p2 = { x: (button.x + 1) * cs, y: centerY - buttonLength / 2 };
                        p3 = { x: (button.x + 1) * cs, y: centerY + buttonLength / 2 };
                        p4 = { x: (button.x + 1) * cs - buttonWidth, y: centerY + buttonLength / 2 };
                        letterCenterX = p1.x + buttonWidth / 2; letterCenterY = centerY;
                        break;
                }

                // 1. 移除填充色绘制

                // 2. 绘制边框
                ctx.strokeStyle = isHighlight ? this.colors.hoverHighlight : this.colors.wall;
                ctx.lineWidth = isHighlight ? Math.max(3, cs / 8) : Math.max(2, cs / 10);
                ctx.beginPath();
                // 确保每个方向都绘制三条线段
                switch (true) {
                    case button.direction.dy === -1: // 顶墙 -> 绘制 左,下,右 三边
                        ctx.moveTo(p1.x, p1.y); // 从 top-left 开始
                        ctx.lineTo(p4.x, p4.y); // 画 左边
                        ctx.lineTo(p3.x, p3.y); // 画 底边
                        ctx.lineTo(p2.x, p2.y); // 画 右边
                        break;
                    case button.direction.dy === 1: // 底墙 -> 绘制 左,上,右 三边
                        ctx.moveTo(p4.x, p4.y); // 从 bottom-left 开始
                        ctx.lineTo(p1.x, p1.y); // 画 左边
                        ctx.lineTo(p2.x, p2.y); // 画 顶边
                        ctx.lineTo(p3.x, p3.y); // 画 右边
                        break;
                    case button.direction.dx === -1: // 左墙 -> 绘制 上,右,下 三边
                        ctx.moveTo(p1.x, p1.y); // 从 top-left 开始
                        ctx.lineTo(p2.x, p2.y); // 画 顶边
                        ctx.lineTo(p3.x, p3.y); // 画 右边
                        ctx.lineTo(p4.x, p4.y); // 画 底边
                        break;
                    case button.direction.dx === 1: // 右墙 -> 绘制 上,左,下 三边
                        ctx.moveTo(p2.x, p2.y); // 从 top-right 开始
                        ctx.lineTo(p1.x, p1.y); // 画 顶边
                        ctx.lineTo(p4.x, p4.y); // 画 左边
                        ctx.lineTo(p3.x, p3.y); // 画 底边
                        break;
                }
                ctx.stroke();

                // 3. 绘制字母 (仅在非高亮模式下，且按钮有字母时)
                if (!isHighlight && button.letter) {
                    const fontSize = this.cellSize * 0.4; // 与字母门统一大小
                    ctx.font = `bold ${fontSize}px sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.strokeStyle = 'black';
                    ctx.lineWidth = 3;
                    ctx.strokeText(button.letter, letterCenterX, letterCenterY);
                    ctx.fillStyle = this.colors.key;
                    ctx.fillText(button.letter, letterCenterX, letterCenterY);
                }
            }

            // ==================================================
            //  编辑器逻辑
            // ==================================================
            
            /**
             * 进入地图编辑器模式
             */
            enterEditorMode() {
                this.stopAnimationLoop();
                if (!this.mapData) { // 如果没有现有地图，则创建一个空白地图
                    this.width = 10;
                    this.height = 10;
                    // 默认为常规模式
                    this.editor.mode = 'regular';
                    this.multiLayerMode = false;
                    this.layerCount = 1;
                    this.currentLayer = 0;
                    this.stairs = [];
                    this.createBlankEditorMap();
                    this.mapData = {
                        width: this.width, height: this.height,
                        hWalls: JSON.parse(JSON.stringify(this.hWalls)),
                        vWalls: JSON.parse(JSON.stringify(this.vWalls)),
                        endPos: null,
                        initialGhosts: [],
                        items: [],
                        activeCells: this.activeCells,
                        editorMode: 'regular',
                        multiLayerMode: false,
                        layerCount: 1,
                        layers: [],
                        stairs: []
                    };
                }

                this.state = GAME_STATES.EDITOR;
                this.editor.active = true;
                this.setEditorTool(EDITOR_TOOLS.WALL);
                
                // 切换UI面板
                document.getElementById('game-controls').style.display = 'none';
                document.getElementById('editor-controls').style.display = 'block';
                
                // 从mapData加载数据到编辑器
                this.width = this.mapData.width;
                this.height = this.mapData.height;
                this.startPos = { x: 1, y: this.height - 2 }; // 默认起点
                this.customStartPos = this.mapData.customStartPos || null; // 加载自定义起点
                this.activeCells = this.mapData.activeCells || Array(this.height).fill(null).map(()=>Array(this.width).fill(true));
                this.editor.mode = this.mapData.editorMode || 'regular';
                
                // 加载多层地图相关状态
                this.multiLayerMode = this.mapData.multiLayerMode || false;
                this.layerCount = this.mapData.layerCount || 1;
                this.currentLayer = 0;
                this.stairs = JSON.parse(JSON.stringify(this.mapData.stairs || []));
                this.layers = JSON.parse(JSON.stringify(this.mapData.layers || []));

                this.editorMapSizeInput.value = this.width;
                this.padding = 15; // 新增
                this.cellSize = (canvas.width - 2 * this.padding) / this.width; // 修改
                this.hWalls = JSON.parse(JSON.stringify(this.mapData.hWalls));
                this.vWalls = JSON.parse(JSON.stringify(this.mapData.vWalls));
                this.endPos = this.mapData.endPos ? {...this.mapData.endPos} : null;
                this.ghosts = JSON.parse(JSON.stringify(this.mapData.initialGhosts || []));
                this.items = JSON.parse(JSON.stringify(this.mapData.items || []));
                this.buttons = JSON.parse(JSON.stringify(this.mapData.buttons || []));
                
                // 更新编辑器UI状态
                this.updateEditorUIForMode();
                this.updateLayerModeUI();
                this.updateLayerPanel();

                this._renderStaticLayer(); // 为编辑器渲染静态背景
                this.drawEditor();
                this.updateDpadVisibility();
            }

            /**
             * 更新图层模式UI按钮状态
             */
            updateLayerModeUI() {
                document.getElementById('layer-mode-single-btn').classList.toggle('active', !this.multiLayerMode);
                document.getElementById('layer-mode-multi-btn').classList.toggle('active', this.multiLayerMode);
            }

            /**
             * 尝试切换编辑模式 (修改：一次确认，强制清空)
             */
            attemptSetEditorMode(mode) {
                if (this.editor.mode === mode) return;
                this.showConfirm(`切换编辑模式将清空当前地图，确定吗？`, () => {
                    this.editor.mode = mode;

                    if (mode === 'free') {
                        // 当切换到自由模式时，执行“重置方格”逻辑
                        // 这个函数会处理自己的渲染，所以后续不需要再调用 draw
                        this.resetGridsAndClearEntities();
                    } else {
                        // 当切换回常规模式时，保持原有逻辑
                        this.createBlankEditorMap();
                        this._renderStaticLayer();
                        this.drawEditor();
                    }

                    this.updateEditorUIForMode();
                });
            }

            /**
             * 根据当前编辑模式更新UI工具的显隐
             */
            updateEditorUIForMode() {
                const isRegular = this.editor.mode === 'regular';
                document.getElementById('edit-type-regular-btn').classList.toggle('active', isRegular);
                document.getElementById('edit-type-free-btn').classList.toggle('active', !isRegular);
                
                // 工具显隐
                document.getElementById('tool-start').style.display = isRegular ? 'none' : 'block';
                document.getElementById('tool-grid').style.display = isRegular ? 'none' : 'block';
                
                // 显示/隐藏图层模式选择器（仅自由模式可用）
                document.getElementById('layer-mode-container').style.display = isRegular ? 'none' : 'block';
                
                // 如果切换到常规模式，重置为单层地图
                if (isRegular && this.multiLayerMode) {
                    this.multiLayerMode = false;
                    this.layerCount = 1;
                    this.currentLayer = 0;
                    this.updateLayerPanel();
                }
                
                // 如果当前工具在当前模式下不可用，重置为墙壁
                if (isRegular && (this.editor.tool === EDITOR_TOOLS.GRID || this.editor.tool === EDITOR_TOOLS.START || this.editor.tool === EDITOR_TOOLS.STAIR)) {
                    this.setEditorTool(EDITOR_TOOLS.WALL);
                }
                
                // 更新楼梯工具显示（仅多层地图模式）
                this.updateStairToolVisibility();
            }

            /**
             * 更新楼梯工具的显示状态
             */
            updateStairToolVisibility() {
                const stairBtn = document.getElementById('tool-stair');
                const shouldShow = this.editor.mode === 'free' && this.multiLayerMode;
                stairBtn.style.display = shouldShow ? 'block' : 'none';
                
                // 如果当前选中楼梯工具但模式不支持，切换到墙壁
                if (!shouldShow && this.editor.tool === EDITOR_TOOLS.STAIR) {
                    this.setEditorTool(EDITOR_TOOLS.WALL);
                }
            }

            /**
             * 设置图层模式（单层/多层）
             * @param {boolean} isMultiLayer - 是否为多层模式
             */
            setLayerMode(isMultiLayer) {
                if (this.multiLayerMode === isMultiLayer) return;
                
                if (!isMultiLayer && this.layerCount > 1) {
                    // 从多层切到单层，需要确认
                    this.showConfirm('地图只会保留第一层的内容，确定吗？', () => {
                        this._applyLayerMode(false);
                    });
                } else {
                    // 从单层切到多层，无需确认
                    this._applyLayerMode(true);
                }
            }

            /**
             * 应用图层模式设置
             */
            _applyLayerMode(isMultiLayer) {
                this.multiLayerMode = isMultiLayer;
                
                document.getElementById('layer-mode-single-btn').classList.toggle('active', !isMultiLayer);
                document.getElementById('layer-mode-multi-btn').classList.toggle('active', isMultiLayer);
                
                if (isMultiLayer) {
                    // 初始化为1层，继承当前地图
                    this.layerCount = 1;
                    this.currentLayer = 0;
                    this.playerLayer = 0;
                    this.stairs = [];
                    
                    // 初始化layers数组，将当前数据放入第0层
                    this.layers = [{
                        hWalls: this.hWalls,
                        vWalls: this.vWalls,
                        activeCells: this.activeCells,
                        ghosts: this.ghosts,
                        items: this.items,
                        buttons: this.buttons,
                        stairs: [],
                        endPos: this.endPos,
                        customStartPos: this.customStartPos
                    }];
                } else {
                    // 重置为单层
                    if (this.layers.length > 0) {
                        // 保留第一层数据
                        const firstLayer = this.layers[0];
                        this.hWalls = firstLayer.hWalls;
                        this.vWalls = firstLayer.vWalls;
                        this.activeCells = firstLayer.activeCells;
                        this.ghosts = firstLayer.ghosts;
                        this.items = firstLayer.items;
                        this.buttons = firstLayer.buttons;
                        this.endPos = firstLayer.endPos;
                        this.customStartPos = firstLayer.customStartPos;
                    }
                    this.layerCount = 1;
                    this.currentLayer = 0;
                    this.playerLayer = 0;
                    this.stairs = [];
                    this.layers = [];
                }
                
                this.updateLayerPanel();
                this.updateStairToolVisibility();
                this._renderStaticLayer();
                this.drawEditor();
            }

            /**
             * 添加新图层
             */
            addLayer() {
                if (this.layerCount >= 10) {
                    this.showToast('最多只能添加10层地图！', 3000, 'error');
                    return;
                }
                
                // 创建新的空白图层
                const empty = () => ({ type: WALL_TYPES.EMPTY, keys: 0 });
                const newLayer = {
                    hWalls: Array(this.height + 1).fill(null).map(() => Array(this.width).fill(null).map(empty)),
                    vWalls: Array(this.height).fill(null).map(() => Array(this.width + 1).fill(null).map(empty)),
                    activeCells: Array(this.height).fill(null).map(() => Array(this.width).fill(true)),
                    ghosts: [],
                    items: [],
                    buttons: [],
                    stairs: [],
                    endPos: null,
                    customStartPos: null
                };
                
                this.layers.push(newLayer);
                this.layerCount++;
                
                this.updateLayerPanel();
                this.showToast(`已添加第 ${this.layerCount} 层`, 2000, 'success');
            }

            /**
             * 删除最上层
             */
            removeLayer() {
                if (this.layerCount <= 1) {
                    this.showToast('初始的1层不可删除！', 3000, 'error');
                    return;
                }
                
                this.showConfirm(`确定要删除第 ${this.layerCount} 层吗？`, () => {
                    // 删除最上层
                    const removedLayer = this.layers.pop();
                    this.layerCount--;
                    
                    // 清除相关楼梯（所有连接到被删除层的楼梯）
                    const removedLayerIndex = this.layerCount; // 被删除层的索引
                    for (let i = 0; i < this.layers.length; i++) {
                        this.layers[i].stairs = this.layers[i].stairs.filter(s => {
                            // 删除向上指向被删除层的楼梯
                            if (s.direction === 'up' && i === removedLayerIndex - 1) {
                                return false;
                            }
                            return true;
                        });
                    }
                    
                    // 如果当前层被删除了，切换到最高层
                    if (this.currentLayer >= this.layerCount) {
                        this.currentLayer = this.layerCount - 1;
                        this._switchToLayer(this.currentLayer);
                    }
                    
                    this.updateLayerPanel();
                    this.showToast(`已删除第 ${this.layerCount + 1} 层`, 2000, 'success');
                });
            }

            /**
             * 切换到指定图层
             */
            switchToLayer(layerIndex) {
                if (layerIndex < 0 || layerIndex >= this.layerCount) return;
                if (layerIndex === this.currentLayer) return;
                
                // 保存当前层数据
                this._saveCurrentLayerData();
                
                // 切换到新层
                this._switchToLayer(layerIndex);
                
                this.updateLayerPanel();
                this._renderStaticLayer();
                this.draw();
            }

            /**
             * 保存当前图层数据到layers数组
             */
            _saveCurrentLayerData() {
                if (!this.multiLayerMode || this.layers.length === 0) return;
                
                this.layers[this.currentLayer] = {
                    hWalls: this.hWalls,
                    vWalls: this.vWalls,
                    activeCells: this.activeCells,
                    ghosts: this.ghosts,
                    items: this.items,
                    buttons: this.buttons,
                    stairs: this.stairs.filter(s => s.layer === this.currentLayer),
                    endPos: this.endPos,
                    customStartPos: this.customStartPos
                };
            }

            /**
             * 从layers数组加载指定图层数据
             */
            _switchToLayer(layerIndex) {
                this.currentLayer = layerIndex;
                
                if (this.layers[layerIndex]) {
                    const layer = this.layers[layerIndex];
                    this.hWalls = layer.hWalls;
                    this.vWalls = layer.vWalls;
                    this.activeCells = layer.activeCells;
                    this.ghosts = layer.ghosts;
                    this.items = layer.items;
                    this.buttons = layer.buttons;
                    this.endPos = layer.endPos;
                    this.customStartPos = layer.customStartPos;
                }
            }

            /**
             * 更新图层面板UI
             */
            updateLayerPanel() {
                const panel = document.getElementById('layer-panel');
                const container = document.getElementById('layer-buttons-container');
                const editControls = document.getElementById('layer-edit-controls');
                
                if (!this.multiLayerMode) {
                    panel.style.display = 'none';
                    return;
                }
                
                // 显示面板
                panel.style.display = 'flex';
                
                // 定位面板到Canvas右侧
                this._positionLayerPanel();
                
                // 清空并重新生成按钮
                container.innerHTML = '';
                
                for (let i = this.layerCount - 1; i >= 0; i--) {
                    const btn = document.createElement('button');
                    btn.className = 'layer-btn';
                    btn.textContent = (i + 1).toString();
                    
                    // 当前显示层为蓝色
                    if (i === this.currentLayer) {
                        btn.classList.add('active');
                    }
                    
                    // 玩家所在层（或起点所在层）用黄色边框
                    if (i === this.playerLayer) {
                        btn.classList.add('player-layer');
                    }
                    
                    btn.addEventListener('click', () => this.switchToLayer(i));
                    container.appendChild(btn);
                }
                
                // 显示/隐藏编辑控制（仅编辑器模式）
                editControls.style.display = this.editor.active ? 'flex' : 'none';
            }

            /**
             * 定位图层面板到Canvas右侧
             */
            _positionLayerPanel() {
                const panel = document.getElementById('layer-panel');
                const canvasEl = document.getElementById('game-canvas');
                if (!panel || !canvasEl) return;
                
                const canvasRect = canvasEl.getBoundingClientRect();
                
                panel.style.left = (canvasRect.right + 10) + 'px';
                panel.style.top = canvasRect.top + 'px';
            }

            /**
             * 初始化窗口大小变化监听器
             */
            _initResizeListener() {
                if (!this._resizeListenerAdded) {
                    window.addEventListener('resize', () => {
                        if (this.multiLayerMode) {
                            this._positionLayerPanel();
                        }
                    });
                    this._resizeListenerAdded = true;
                }
            }
            
            /**
             * 创建一个带外墙和起始房间的空白地图
             */
            createBlankEditorMap() {
                this.padding = 15;
                this.cellSize = (canvas.width - 2 * this.padding) / this.width;
                
                const wall = () => ({ type: WALL_TYPES.SOLID, keys: 0 });
                const empty = () => ({ type: WALL_TYPES.EMPTY, keys: 0 });
                const door = () => ({ type: WALL_TYPES.DOOR, keys: 0 });

                // 1. 总是清空墙体和实体
                this.hWalls = Array(this.height + 1).fill(null).map(() => Array(this.width).fill(null).map(empty));
                this.vWalls = Array(this.height).fill(null).map(() => Array(this.width + 1).fill(null).map(empty));
                this.customStartPos = null;
                
                // 2. 总是将方格填满
                this.activeCells = Array(this.height).fill(null).map(() => Array(this.width).fill(true));

                // 3. 如果是常规模式，额外添加外墙和起始房间
                if (this.editor.mode === 'regular') {
                    for (let x = 0; x < this.width; x++) {
                        this.hWalls[0][x] = wall();
                        this.hWalls[this.height][x] = wall();
                    }
                    for (let y = 0; y < this.height; y++) {
                        this.vWalls[y][0] = wall();
                        this.vWalls[y][this.width] = wall();
                    }
                    
                    const roomY = this.height - 3;
                    for (let x = 0; x < 3; x++) this.hWalls[roomY + 3][x] = wall();
                    for (let y = roomY; y < roomY + 3; y++) this.vWalls[y][0] = wall();
                    this.hWalls[roomY][0] = wall(); this.hWalls[roomY][2] = wall();
                    this.vWalls[roomY][3] = wall(); this.vWalls[roomY+2][3] = wall();
                    this.hWalls[roomY][1] = door();
                    this.vWalls[roomY+1][3] = door();
                }
                
                // 4. 重置所有实体
                this.startPos = { x: 1, y: this.height - 2 };
                this.endPos = null;
                this.ghosts = [];
                this.items = [];
                this.buttons = [];
                this.stairs = []; // 清空楼梯
                
                // 5. 重置多层相关
                if (this.multiLayerMode) {
                    this.layers = [{
                        hWalls: this.hWalls,
                        vWalls: this.vWalls,
                        activeCells: this.activeCells,
                        ghosts: [],
                        items: [],
                        buttons: [],
                        stairs: [],
                        endPos: null,
                        customStartPos: null
                    }];
                    this.layerCount = 1;
                    this.currentLayer = 0;
                }
            }

            /**
             * 在编辑器中调整地图大小并清空地图
             */
            resizeAndClearEditor() {
                const size = parseInt(this.editorMapSizeInput.value);
                if (size < 8 || size > 20) {
                    this.showToast('地图大小必须在 8 到 20 之间。', 3000, 'error');
                    this.editorMapSizeInput.value = this.width;
                    return;
                }
                this.width = size;
                this.height = size;
                // createBlankEditorMap 会重新计算 cellSize，所以这里不需要手动计算
                this.createBlankEditorMap();
                this._renderStaticLayer(); // 尺寸变化，重新渲染静态层
                this.drawEditor();
            }
            
            /**
             * 退出编辑器，并使用当前编辑的地图开始游戏
             */
            playEditedMap() {
                // 校验逻辑
                if (this.editor.mode === 'free') {
                    if (!this.customStartPos) { 
                        this.showToast('自由模式必须设置起点！', 3000, 'error'); 
                        return; 
                    }
                }

                this.editor.active = false;
                document.getElementById('game-controls').style.display = 'block';
                document.getElementById('editor-controls').style.display = 'none';
                
                // 从编辑器UI获取初始生命/体力值
                this.initialHealth = parseInt(document.getElementById('editor-initial-health').value) || 5;
                this.initialStamina = parseInt(document.getElementById('editor-initial-stamina').value) || 100;

                // 保存当前层数据到layers
                if (this.multiLayerMode) {
                    this._saveCurrentLayerData();
                }

                // 组装地图数据
                const editedMapData = {
                    width: this.width, height: this.height,
                    hWalls: this.hWalls, vWalls: this.vWalls,
                    endPos: this.endPos,
                    initialGhosts: this.ghosts.map((g, i) => ({x: g.x, y: g.y, id: i})),
                    items: this.items,
                    buttons: this.buttons,
                    activeCells: this.activeCells, 
                    editorMode: this.editor.mode, 
                    customStartPos: this.customStartPos,
                    // 多层地图数据
                    multiLayerMode: this.multiLayerMode,
                    layerCount: this.layerCount,
                    layers: JSON.parse(JSON.stringify(this.layers)),
                    stairs: JSON.parse(JSON.stringify(this.stairs))
                };
                
                // 只需要调用 startGame，它内部会自动更新 URL
                this.startGame(editedMapData);

                this.updateDpadVisibility(); 
            }
            
            /**
             * 更新浏览器地址栏 URL，无刷新替换当前分享码
             */
            updateURLWithShareCode(code) {
                if (!code) return;
                // 使用 URL API 更加安全和规范
                const url = new URL(window.location.href);
                // 设置 ?map=xxxx
                url.searchParams.set('map', code);
                // 清理掉 hash (#xxx) 避免混淆，因为我们现在主要用 ?map=
                url.hash = '';
                // 替换历史记录，不产生新记录，不刷新页面
                window.history.replaceState({}, "", url.toString());
            }

            /**
             * 仅清空编辑器中的元件（墙、实体），保留地图方格形状
             */
            clearEntitiesOnly() {
                const empty = () => ({ type: WALL_TYPES.EMPTY, keys: 0 });
                // 重置所有墙体为空
                this.hWalls = Array(this.height + 1).fill(null).map(() => Array(this.width).fill(null).map(empty));
                this.vWalls = Array(this.height).fill(null).map(() => Array(this.width + 1).fill(null).map(empty));

                // 清空所有实体
                this.endPos = null;
                this.customStartPos = null;
                this.ghosts = [];
                this.items = [];
                this.buttons = [];

                this.drawEditor();
            }

            /**
             * [新增] 清空所有地图方格和元件（自由模式专用）
             */
            clearAllGridsAndEntities() {
                // 1. 将所有方格设置为空（虚空）
                this.activeCells = Array(this.height).fill(null).map(() => Array(this.width).fill(false));

                // 2. 清空所有元件
                this.clearEntitiesOnly(); // 复用清空元件的逻辑

                // 3. 【核心修复】重新渲染静态背景层以反映方格变化
                this._renderStaticLayer();

                // 4. 重绘编辑器
                this.drawEditor();
            }

            /**
             * [新增] 重置所有地图方格为填满状态，并清空所有元件（自由模式专用）
             */
            resetGridsAndClearEntities() {
                // 1. 将所有方格设置为填满
                this.activeCells = Array(this.height).fill(null).map(() => Array(this.width).fill(true));

                // 2. 清空所有元件
                this.clearEntitiesOnly(); // 复用清空元件的逻辑

                // 3. 重新渲染静态背景层
                this._renderStaticLayer();

                // 4. 重绘编辑器
                this.drawEditor();
            }

            /**
             * 显示清空地图的四选项确认框
             */
            showClearMapConfirm() {
                this.clearMapConfirmOverlay.style.display = 'flex';

                const hide = () => {
                    this.clearMapConfirmOverlay.style.display = 'none';
                    // 移除事件监听，避免重复绑定
                    this.clearEntitiesBtn.onclick = null;
                    this.resetGridsBtn.onclick = null; // 新增
                    this.clearGridsBtn.onclick = null;
                    this.clearCancelBtn.onclick = null;
                };

                // 绑定“清空元件”按钮事件
                this.clearEntitiesBtn.onclick = () => {
                    hide();
                    this.clearEntitiesOnly();
                };

                // 新增：绑定“重置方格”按钮事件
                this.resetGridsBtn.onclick = () => {
                    hide();
                    this.resetGridsAndClearEntities();
                };

                // 绑定“清空方格”按钮事件
                this.clearGridsBtn.onclick = () => {
                    hide();
                    this.clearAllGridsAndEntities();
                };

                // 绑定“取消”按钮事件
                this.clearCancelBtn.onclick = hide;
            }

            /**
             * 清空编辑器中的所有内容
             */
            clearEditorMap() {
                if (this.editor.mode === 'free') {
                    // 自由模式下，显示新的三选项弹窗
                    this.showClearMapConfirm();
                } else {
                    // 常规模式下，保持旧的双选项弹窗
                    this.showConfirm('你确定要清空所有墙壁、实体和物品吗？', () => {
                        this.createBlankEditorMap();
                        this.drawEditor();
                    });
                }
            }
            
            /**
             * 设置当前使用的编辑器工具
             * @param {string} tool - 工具名称
             */
            setEditorTool(tool) {
                this.editor.tool = tool;
                document.querySelectorAll('.tool-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.id === `tool-${tool}`);
                });
                this.editor.hoveredWall = null;
                this.drawEditor();
            }
            
            /**
             * 渲染编辑器界面
             */
            drawEditor() {
                // 1. 清空整个画布
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                
                // 2. 应用偏移 (Padding)
                ctx.save();
                ctx.translate(this.padding, this.padding);

                const cs = this.cellSize;

                // 3. 绘制静态层 (地面)
                ctx.drawImage(this.staticLayerCanvas, 0, 0);

                // 4. 绘制虚线网格 (仅自由模式，且在墙体之前绘制)
                if (this.editor.mode === 'free') {
                    ctx.beginPath();
                    ctx.strokeStyle = this.colors.voidGrid;
                    ctx.lineWidth = 1;
                    ctx.setLineDash([5, 5]);
                    
                    // 绘制虚空格子
                    for(let y=0; y<this.height; y++) {
                        for(let x=0; x<this.width; x++) {
                            if(!this.activeCells[y][x]) {
                                ctx.strokeRect(x*cs, y*cs, cs, cs);
                            }
                        }
                    }
                    // 绘制最大边界框
                    ctx.strokeRect(0, 0, this.width * cs, this.height * cs);
                    ctx.setLineDash([]);
                }

                // 5. 常规模式起始房间高亮
                if (this.editor.mode === 'regular') {
                    ctx.fillStyle = this.colors.startRoomHighlight;
                    ctx.fillRect(0, (this.height - 3) * cs, 3 * cs, 3 * cs);
                }
                
                // 6. 绘制墙体
                ctx.beginPath();
                const shouldDrawBoundary = (bx, by, isH) => {
                    if (isH) {
                        const up = (by > 0) ? this.activeCells[by-1][bx] : false;
                        const down = (by < this.height) ? this.activeCells[by][bx] : false;
                        return up !== down;
                    } else {
                        const left = (bx > 0) ? this.activeCells[by][bx-1] : false;
                        const right = (bx < this.width) ? this.activeCells[by][bx] : false;
                        return left !== right;
                    }
                };

                for (let y = 0; y <= this.height; y++) {
                    for (let x = 0; x < this.width; x++) {
                        const isActiveRow = (y < this.height && this.activeCells[y][x]) || (y > 0 && this.activeCells[y-1][x]);
                        if (!isActiveRow) continue;

                        if (this.hWalls[y][x].type > 0) this.drawWallOrDoor(x * cs, y * cs, (x + 1) * cs, y * cs, this.hWalls[y][x]);
                        else if (this.editor.mode === 'free' && shouldDrawBoundary(x, y, true)) this.drawWallOrDoor(x * cs, y * cs, (x + 1) * cs, y * cs, {type:1});
                    }
                }
                for (let y = 0; y < this.height; y++) {
                    for (let x = 0; x <= this.width; x++) {
                        const isActiveCol = (x < this.width && this.activeCells[y][x]) || (x > 0 && this.activeCells[y][x-1]);
                        if (!isActiveCol) continue;

                        if (this.vWalls[y][x].type > 0) this.drawWallOrDoor(x * cs, y * cs, x * cs, (y + 1) * cs, this.vWalls[y][x]);
                        else if (this.editor.mode === 'free' && shouldDrawBoundary(x, y, false)) this.drawWallOrDoor(x * cs, y * cs, x * cs, (y + 1) * cs, {type:1});
                    }
                }
                ctx.stroke();

                // 7. 绘制墙角填充
                this.drawCorners(true);

                // 8. 绘制墙体覆盖物 (数字、箭头等)
                this.drawWallOverlays();
                
                // 9. 鼠标悬停高亮逻辑
                if (this.editor.tool === EDITOR_TOOLS.GRID && this.editor.hoveredWall) {
                    const {x, y} = this.editor.hoveredWall;
                    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
                        ctx.fillStyle = "rgba(255, 255, 0, 0.3)";
                        ctx.fillRect(x * cs, y * cs, cs, cs);
                    }
                } else if (this.editor.hoveredWall && !this.editor.isDragging && this.editor.tool !== EDITOR_TOOLS.ERASER) {
                    const {x, y, type, direction} = this.editor.hoveredWall;
                    let wallType = 1;
                    switch(this.editor.tool) {
                        case EDITOR_TOOLS.DOOR: wallType=2; break; case EDITOR_TOOLS.GLASS: wallType=5; break; case EDITOR_TOOLS.LOCK: wallType=3; break; case EDITOR_TOOLS.ONE_WAY: wallType=4; break; case EDITOR_TOOLS.LETTER_DOOR: wallType=6; break; default: wallType=1;
                    }
                    const isValidWall = (type==='h') 
                        ? (y>0 && this.activeCells[y-1][x]) || (y<this.height && this.activeCells[y][x])
                        : (x>0 && this.activeCells[y][x-1]) || (x<this.width && this.activeCells[y][x]);

                    if (isValidWall) {
                         ctx.beginPath();
                         const wallObject = { type: wallType, keys: '?', direction: direction };
                         if (type === 'h') this.drawWallOrDoor(x * cs, y * cs, (x + 1) * cs, y * cs, wallObject, true);
                         else this.drawWallOrDoor(x * cs, y * cs, x * cs, (y + 1) * cs, wallObject, true);
                         ctx.stroke();

                         if (wallObject.type === WALL_TYPES.ONE_WAY && wallObject.direction) {
                            if (type === 'h') {
                                this.drawArrow(x * cs, y * cs, (x + 1) * cs, y * cs, direction, 'white', false);
                            } else {
                                this.drawArrow(x * cs, y * cs, x * cs, (y + 1) * cs, direction, 'white', false);
                            }
                        }
                    }
                }

               // 10. 绘制所有楼梯（在其他实体之前，即最底层）
                this.stairs.filter(s => s.layer === this.currentLayer).forEach(s => this.drawStair(s));
                
                // 绘制楼梯工具的悬停预览
                if (this.editor.tool === EDITOR_TOOLS.STAIR && this.editor.stairPlacement && !this.editor.isDragging) {
                    this.drawStair(this.editor.stairPlacement, true);
                }

               // 11. 绘制所有实体
                this.items.forEach(item => this.drawItem(item));
                if (this.endPos) this.drawCircle(this.endPos.x, this.endPos.y, this.colors.endPoint);
                if (this.customStartPos) this.drawCircle(this.customStartPos.x, this.customStartPos.y, this.colors.player); 
                this.ghosts.forEach(g => this.drawCircle(g.x, g.y, this.colors.ghost));
                this.buttons.forEach(b => this.drawButton(b));
                if (this.editor.mode === 'regular') this.drawCircle(this.startPos.x, this.startPos.y, this.colors.player);

                // 12. 绘制按钮热点预览
                if (this.editor.hoveredButtonHotspot) {
                    const virtualButton = {
                        x: this.editor.hoveredButtonHotspot.x,
                        y: this.editor.hoveredButtonHotspot.y,
                        direction: this.editor.hoveredButtonHotspot.direction
                    };
                    this.drawButton(virtualButton, true);
                }
                
                // 13. 恢复画布状态
                ctx.restore();
            }
            
            /**
             * 获取鼠标在Canvas上的坐标
             * @param {MouseEvent|TouchEvent} e - 事件对象
             * @returns {object} 坐标 {x, y}
             */
            getMousePos(e) {
                const rect = canvas.getBoundingClientRect();
                const scaleX = canvas.width / rect.width;
                const scaleY = canvas.height / rect.height;
                const mx = (e.clientX - rect.left) * scaleX;
                const my = (e.clientY - rect.top) * scaleY;
                
                // 游戏模式下，drawOffset 会自动包含 padding 带来的偏移（因为它是居中计算的）
                if (this.state === GAME_STATES.PLAYING) {
                    return { x: mx - this.drawOffset.x, y: my - this.drawOffset.y };
                }
                // 编辑器模式下，需要手动减去 padding
                return { x: mx - (this.padding || 0), y: my - (this.padding || 0) };
            }
            
            /**
             * 检查指定格子是否在固定的起始房间内
             */
            isPosInStartRoom(cellX, cellY) {
                // 常规模式才检查固定起始房间
                if (this.editor.mode === 'regular') {
                    const roomY = this.height - 3;
                    return cellX >= 0 && cellX < 3 && cellY >= roomY && cellY < roomY + 3;
                }
                return false;
            }
            
            /**
             * 检查指定的墙体是否可被编辑（防止编辑外墙和起始房间的墙）
             */
            isWallEditable(wall) {
                if (!wall) return false;
                
                if (this.editor.mode === 'free') {
                    // 自由模式: 只有当墙体两侧都是有效格子（内部墙）时，才能作为“门/窗/单向”编辑
                    // 边界墙（一侧有效一侧虚空）是系统自动生成的，不可编辑为通过点
                    const {x, y, type} = wall;
                    const up = (type==='h' && y>0) ? this.activeCells[y-1][x] : false;
                    const down = (type==='h' && y<this.height) ? this.activeCells[y][x] : false;
                    const left = (type==='v' && x>0) ? this.activeCells[y][x-1] : false;
                    const right = (type==='v' && x<this.width) ? this.activeCells[y][x] : false;
                    
                    if (type==='h') return up && down;
                    if (type==='v') return left && right;
                    return false;
                }

                // Regular logic...
                const {x, y, type} = wall;
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

            /**
             * 检查指定格子是否已被实体（终点、鬼、物品）占据
             */
            isCellOccupiedInEditor(x, y) {
                if (this.endPos && this.endPos.x === x && this.endPos.y === y) return true;
                if (this.customStartPos && this.customStartPos.x === x && this.customStartPos.y === y) return true; // Check start
                if (this.ghosts.some(g => g.x === x && g.y === y)) return true;
                if (this.items.some(i => i.x === x && i.y === y)) return true;
                return false;
            }

            /**
             * 使用橡皮擦工具擦除指定位置的墙体或实体
             */
            eraseAtPos(pos) {
                // 橡皮擦 不影响 地图方格的有效性
                const wall = this.getWallAtPos(pos.x, pos.y);
                if (wall && this.isWallEditable(wall)) {
                    if (wall.type === 'h') this.hWalls[wall.y][wall.x] = { type: WALL_TYPES.EMPTY, keys: 0 };
                    else this.vWalls[wall.y][wall.x] = { type: WALL_TYPES.EMPTY, keys: 0 };
                }

                const cellX = Math.floor(pos.x / this.cellSize);
                const cellY = Math.floor(pos.y / this.cellSize);
                if (this.editor.mode === 'free' || !this.isPosInStartRoom(cellX, cellY)) {
                    if (this.endPos && this.endPos.x === cellX && this.endPos.y === cellY) {
                        this.endPos = null;
                    }
                    if (this.customStartPos && this.customStartPos.x === cellX && this.customStartPos.y === cellY) {
                        this.customStartPos = null; // Erase custom start
                    }
                    this.ghosts = this.ghosts.filter(g => g.x !== cellX || g.y !== cellY);
                    this.items = this.items.filter(i => i.x !== cellX || i.y !== cellY);
                    
                    // 清除楼梯（包括对应层的配对楼梯）
                    this.eraseStairAt(cellX, cellY, this.currentLayer);
                }
                this.drawEditor();
            }

            /**
             * 清除指定位置的楼梯及其配对楼梯
             */
            eraseStairAt(x, y, layer) {
                const stair = this.stairs.find(s => s.x === x && s.y === y && s.layer === layer);
                if (!stair) return;
                
                // 找到配对楼梯
                const pairedLayer = stair.direction === 'up' ? layer + 1 : layer - 1;
                const pairedDirection = stair.direction === 'up' ? 'down' : 'up';
                
                // 移除两个楼梯
                this.stairs = this.stairs.filter(s => 
                    !(s.x === x && s.y === y && s.layer === layer) &&
                    !(s.x === x && s.y === y && s.layer === pairedLayer && s.direction === pairedDirection)
                );
            }

            /**
             * 处理游戏模式下的Canvas点击事件，用于玩家自动寻路移动
             */
            handleCanvasClick(e) {
                if (this.state !== GAME_STATES.PLAYING || this.editor.active) return;
                this.stopAutoMove();

                const pos = this.getMousePos(e);
                const targetX = Math.floor(pos.x / this.cellSize);
                const targetY = Math.floor(pos.y / this.cellSize);

                if (targetX < 0 || targetX >= this.width || targetY < 0 || targetY >= this.height) return;
                
                // 如果点击的是相邻格子，则直接移动
                const dx = targetX - this.player.x;
                const dy = targetY - this.player.y;
                if (Math.abs(dx) + Math.abs(dy) === 1) {
                    this.movePlayer(dx, dy);
                    return;
                }

                // 如果点击的是不可见区域，则不响应
                if (!this.seenCells[targetY][targetX] && !this.debugVision) return;

                // 寻路到目标点
                const path = this.findPlayerPath(this.player, {x: targetX, y: targetY});
                
                if (path && path.length > 1) {
                    let currentStep = 1;
                    const move = () => {
                        if (currentStep >= path.length || this.state !== GAME_STATES.PLAYING) {
                            this.stopAutoMove();
                            return;
                        }
                        const nextPos = path[currentStep];
                        const dx = nextPos.x - this.player.x;
                        const dy = nextPos.y - this.player.y;
                        this.movePlayer(dx, dy);
                        currentStep++;
                    };
                    move(); // 立即移动第一步
                    if (path.length > 2) {
                        this.autoMoveInterval = setInterval(move, 200); // 之后每隔200ms移动一步
                    }
                }
            }

            /**
             * 停止玩家的自动移动
             */
            stopAutoMove() {
                if (this.autoMoveInterval) {
                    clearInterval(this.autoMoveInterval);
                    this.autoMoveInterval = null;
                }
                if (this.dpadInterval) { 
                    clearInterval(this.dpadInterval);
                }
            }

            /**
             * 处理编辑器模式下的鼠标按下事件
             */
            handleCanvasMouseDown(e) {
                if (!this.editor.active) return;
                
                this.editor.isDragging = true;
                this.editor.didDrag = false;
                this.editor.hoveredWall = null; // 新增：开始拖动时立即清除悬停状态
                const pos = this.getMousePos(e);

                if (this.editor.tool === EDITOR_TOOLS.GRID && this.editor.mode === 'free') {
                    const cellX = Math.floor(pos.x / this.cellSize);
                    const cellY = Math.floor(pos.y / this.cellSize);
                    if (cellX >= 0 && cellX < this.width && cellY >= 0 && cellY < this.height) {
                        // 确定本次拖动的行为：如果当前是 active，则行为是 remove，反之 add
                        this.editor.gridDragAction = this.activeCells[cellY][cellX] ? 'remove' : 'add';
                        this.toggleActiveCell(cellX, cellY, this.editor.gridDragAction);
                    }
                } else if (this.editor.tool === EDITOR_TOOLS.STAIR && this.multiLayerMode) {
                    // 楼梯工具：开始放置楼梯
                    const cellX = Math.floor(pos.x / this.cellSize);
                    const cellY = Math.floor(pos.y / this.cellSize);
                    if (cellX >= 0 && cellX < this.width && cellY >= 0 && cellY < this.height) {
                        // 检查是否已有楼梯
                        const existingStair = this.stairs.find(s => s.x === cellX && s.y === cellY && s.layer === this.currentLayer);
                        if (existingStair) {
                            // 点击已有楼梯，清除它
                            this.eraseStairAt(cellX, cellY, this.currentLayer);
                            this.drawEditor();
                        } else {
                            // 开始放置新楼梯
                            const localY = pos.y - cellY * this.cellSize;
                            const direction = localY < this.cellSize / 2 ? 'up' : 'down';
                            this.editor.stairPlacement = { x: cellX, y: cellY, direction, layer: this.currentLayer };
                            this.drawEditor();
                        }
                    }
                } else if (this.editor.tool === EDITOR_TOOLS.WALL || this.editor.tool === EDITOR_TOOLS.GLASS) { 
                    const wall = this.getWallAtPos(pos.x, pos.y);
                    if (wall && this.isWallEditable(wall)) {
                        this.editor.dragAxis = wall.type;
                        const type = this.editor.tool === EDITOR_TOOLS.GLASS ? WALL_TYPES.GLASS : WALL_TYPES.SOLID;
                        this.toggleWall(wall, type); 
                        this.editor.lastDragPos = wall;
                    } else {
                        this.editor.dragAxis = null;
                    }
                } else if (this.editor.tool === EDITOR_TOOLS.ERASER) {
                    this.eraseAtPos(pos);
                } else if (this.editor.tool === EDITOR_TOOLS.ONE_WAY) {
                    const wall = this.getWallAtPos(pos.x, pos.y);
                    if (wall && this.isWallEditable(wall)) {
                        const direction = this.getMouseSideOfWall(pos.x, pos.y, wall);
                        const newWall = { type: WALL_TYPES.ONE_WAY, direction: direction };
                        if (wall.type === 'h') this.hWalls[wall.y][wall.x] = newWall;
                        else this.vWalls[wall.y][wall.x] = newWall;
                        this.editor.lastDragPos = wall; 
                        this.drawEditor();
                    }
                }
            }

            /**
             * 处理编辑器模式下的鼠标移动事件
             */
            handleCanvasMouseMove(e) {
                if (!this.editor.active) return;
                const pos = this.getMousePos(e);

                // Grid Tool Logic
                if (this.editor.tool === EDITOR_TOOLS.GRID && this.editor.mode === 'free') {
                    const cellX = Math.floor(pos.x / this.cellSize);
                    const cellY = Math.floor(pos.y / this.cellSize);

                    if (this.editor.isDragging) {
                        // --- 拖动逻辑 ---
                        // 正在拖动时，不应该有任何悬停状态
                        this.editor.hoveredWall = null; 
                        
                        this.editor.didDrag = true;
                        if (cellX >= 0 && cellX < this.width && cellY >= 0 && cellY < this.height) {
                            const currentStatus = this.activeCells[cellY][cellX];
                            if ((this.editor.gridDragAction === 'add' && !currentStatus) ||
                                (this.editor.gridDragAction === 'remove' && currentStatus)) {
                                this.toggleActiveCell(cellX, cellY, this.editor.gridDragAction);
                            }
                        }
                    } else {
                        // --- 悬停逻辑 ---
                        // 只有在没有拖动时，才更新悬停位置并重绘
                        if (!this.editor.hoveredWall || this.editor.hoveredWall.x !== cellX || this.editor.hoveredWall.y !== cellY) {
                            this.editor.hoveredWall = {x: cellX, y: cellY};
                            this.drawEditor();
                        }
                    }
                    return;
                }

                // Stair Tool Logic
                if (this.editor.tool === EDITOR_TOOLS.STAIR && this.multiLayerMode) {
                    if (this.editor.stairPlacement && this.editor.isDragging) {
                        // 拖动时更新楼梯方向
                        const cellX = this.editor.stairPlacement.x;
                        const cellY = this.editor.stairPlacement.y;
                        const localY = pos.y - cellY * this.cellSize;
                        const direction = localY < this.cellSize / 2 ? 'up' : 'down';
                        
                        if (this.editor.stairPlacement.direction !== direction) {
                            this.editor.stairPlacement.direction = direction;
                            this.editor.didDrag = true;
                            this.drawEditor();
                        }
                    } else if (!this.editor.isDragging) {
                        // 悬停预览
                        const cellX = Math.floor(pos.x / this.cellSize);
                        const cellY = Math.floor(pos.y / this.cellSize);
                        if (cellX >= 0 && cellX < this.width && cellY >= 0 && cellY < this.height && this.activeCells[cellY][cellX]) {
                            const existingStair = this.stairs.find(s => s.x === cellX && s.y === cellY && s.layer === this.currentLayer);
                            if (!existingStair) {
                                const localY = pos.y - cellY * this.cellSize;
                                const direction = localY < this.cellSize / 2 ? 'up' : 'down';
                                const valid = this.isValidStairPlacement(cellX, cellY, direction);
                                
                                if (valid) {
                                    const newPlacement = { x: cellX, y: cellY, direction, layer: this.currentLayer };
                                    if (!this.editor.stairPlacement || 
                                        this.editor.stairPlacement.x !== newPlacement.x ||
                                        this.editor.stairPlacement.y !== newPlacement.y ||
                                        this.editor.stairPlacement.direction !== newPlacement.direction) {
                                        this.editor.stairPlacement = newPlacement;
                                        this.drawEditor();
                                    }
                                } else if (this.editor.stairPlacement) {
                                    this.editor.stairPlacement = null;
                                    this.drawEditor();
                                }
                            } else if (this.editor.stairPlacement) {
                                this.editor.stairPlacement = null;
                                this.drawEditor();
                            }
                        } else if (this.editor.stairPlacement) {
                            this.editor.stairPlacement = null;
                            this.drawEditor();
                        }
                    }
                    return;
                }

                const isWallTool = [EDITOR_TOOLS.WALL, EDITOR_TOOLS.DOOR, EDITOR_TOOLS.LOCK, EDITOR_TOOLS.ONE_WAY, EDITOR_TOOLS.GLASS, EDITOR_TOOLS.LETTER_DOOR].includes(this.editor.tool);

                if (!this.editor.isDragging) {
                    let needsRedraw = false;

                    // 先处理墙体工具
                    if (isWallTool) {
                        const wall = this.getWallAtPos(pos.x, pos.y);
                        // 清除按钮高亮
                        if (this.editor.hoveredButtonHotspot) {
                            this.editor.hoveredButtonHotspot = null;
                            needsRedraw = true;
                        }
                        
                        if (wall && this.isWallEditable(wall)) {
                            // 检查悬停的墙体是否发生变化
                            if (!this.editor.hoveredWall || this.editor.hoveredWall.x !== wall.x || this.editor.hoveredWall.y !== wall.y || this.editor.hoveredWall.type !== wall.type) {
                                this.editor.hoveredWall = wall;
                                needsRedraw = true;
                            }
                            // 特别处理单向门的方向预览
                            if (this.editor.tool === EDITOR_TOOLS.ONE_WAY) {
                                const direction = this.getMouseSideOfWall(pos.x, pos.y, wall);
                                if (!this.editor.hoveredWall.direction || this.editor.hoveredWall.direction.dx !== direction.dx || this.editor.hoveredWall.direction.dy !== direction.dy) {
                                    this.editor.hoveredWall.direction = direction;
                                    needsRedraw = true;
                                }
                            }
                        } else if (this.editor.hoveredWall) {
                            this.editor.hoveredWall = null;
                            needsRedraw = true;
                        }
                    // 再处理按钮工具
                    } else if (this.editor.tool === EDITOR_TOOLS.BUTTON) {
                        const hotspot = this.getButtonHotspotAtPos(pos.x, pos.y);
                        // 清除墙体高亮
                        if (this.editor.hoveredWall) {
                            this.editor.hoveredWall = null;
                            needsRedraw = true;
                        }
                        if (hotspot?.x !== this.editor.hoveredButtonHotspot?.x || hotspot?.y !== this.editor.hoveredButtonHotspot?.y || hotspot?.direction.dx !== this.editor.hoveredButtonHotspot?.direction.dx) {
                             this.editor.hoveredButtonHotspot = hotspot;
                             needsRedraw = true;
                        }
                    // 其他工具则清除所有高亮
                    } else {
                        if (this.editor.hoveredWall) { this.editor.hoveredWall = null; needsRedraw = true; }
                        if (this.editor.hoveredButtonHotspot) { this.editor.hoveredButtonHotspot = null; needsRedraw = true; }
                    }

                    if (needsRedraw) {
                        this.drawEditor();
                    }
                    return;
                }

                // 处理拖动逻辑
                this.editor.didDrag = true;
                this.editor.hoveredWall = null;

                if ((this.editor.tool === EDITOR_TOOLS.WALL || this.editor.tool === EDITOR_TOOLS.GLASS) && this.editor.dragAxis) {
                    let wall;
                    if (this.editor.dragAxis === 'h') {
                        const x = Math.floor(pos.x / this.cellSize);
                        const y = this.editor.lastDragPos.y;
                        wall = { type: 'h', x, y };
                    } else {
                        const y = Math.floor(pos.y / this.cellSize);
                        const x = this.editor.lastDragPos.x;
                        wall = { type: 'v', x, y };
                    }
                    
                    if (wall && this.isWallEditable(wall) && (wall.x !== this.editor.lastDragPos.x || wall.y !== this.editor.lastDragPos.y)) {
                        const newType = this.editor.tool === EDITOR_TOOLS.GLASS ? WALL_TYPES.GLASS : WALL_TYPES.SOLID;
                        if (wall.type === 'h') this.hWalls[wall.y][wall.x] = { type: newType };
                        else this.vWalls[wall.y][wall.x] = { type: newType };
                        this.drawEditor();
                        this.editor.lastDragPos = wall;
                    }
                } else if (this.editor.tool === EDITOR_TOOLS.ERASER) {
                    this.eraseAtPos(pos);
                } else if (this.editor.tool === EDITOR_TOOLS.ONE_WAY && this.editor.lastDragPos) {
                    const wallData = this.editor.lastDragPos;
                    const newDirection = this.getMouseSideOfWall(pos.x, pos.y, wallData);
                    let currentWall = (wallData.type === 'h') ? this.hWalls[wallData.y][wallData.x] : this.vWalls[wallData.y][wallData.x];
                    if (currentWall && currentWall.type === WALL_TYPES.ONE_WAY && (currentWall.direction.dx !== newDirection.dx || currentWall.direction.dy !== newDirection.dy)) {
                        currentWall.direction = newDirection;
                        this.drawEditor();
                    }
                }
            }

            /**
             * 切换活动方格状态，并自动清理关联实体
             */
            toggleActiveCell(x, y, action) {
                if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
                const newState = (action === 'add');
                if (this.activeCells[y][x] === newState) return;

                this.activeCells[y][x] = newState;

                // 如果清除了方格，移除上面的实体和墙
                if (!newState) {
                    if (this.customStartPos && this.customStartPos.x === x && this.customStartPos.y === y) this.customStartPos = null;
                    if (this.endPos && this.endPos.x === x && this.endPos.y === y) this.endPos = null;
                    this.ghosts = this.ghosts.filter(g => g.x !== x || g.y !== y);
                    this.items = this.items.filter(i => i.x !== x || i.y !== y);
                    this.buttons = this.buttons.filter(b => b.x !== x || b.y !== y);
                    // 清除楼梯
                    this.eraseStairAt(x, y, this.currentLayer);
                    // 清除内部墙数据 (设为 Empty，避免渲染混淆)
                    this.hWalls[y][x] = {type:0}; this.hWalls[y+1][x] = {type:0};
                    this.vWalls[y][x] = {type:0}; this.vWalls[y][x+1] = {type:0};
                }

                this._renderStaticLayer(); // Re-render grid/void
                this.drawEditor();
            }

            /**
             * 检查楼梯放置是否有效
             */
            isValidStairPlacement(x, y, direction) {
                // 检查当前位置是否是有效方格
                if (!this.activeCells[y][x]) return false;
                
                // 检查目标层是否存在
                const targetLayer = direction === 'up' ? this.currentLayer + 1 : this.currentLayer - 1;
                if (targetLayer < 0 || targetLayer >= this.layerCount) return false;
                
                // 检查目标层的对应位置是否是有效方格（不是虚空）
                if (this.layers[targetLayer]) {
                    const targetActiveCells = this.layers[targetLayer].activeCells;
                    if (!targetActiveCells[y][x]) return false;
                }
                
                return true;
            }

            /**
             * 放置楼梯
             */
            placeStair(x, y, direction) {
                if (!this.isValidStairPlacement(x, y, direction)) {
                    this.showToast('无效放置', 2000, 'error');
                    return false;
                }
                
                const targetLayer = direction === 'up' ? this.currentLayer + 1 : this.currentLayer - 1;
                const pairedDirection = direction === 'up' ? 'down' : 'up';
                
                // 在当前层添加楼梯
                this.stairs.push({ x, y, direction, layer: this.currentLayer });
                
                // 在目标层添加配对楼梯
                this.stairs.push({ x, y, direction: pairedDirection, layer: targetLayer });
                
                return true;
            }
            
            /**
             * 处理编辑器模式下的鼠标松开事件
             */
            handleCanvasMouseUp(e) {
                if (!this.editor.active) return;
                this.editor.gridDragAction = null; // Reset grid action

                // 处理楼梯放置完成
                if (this.editor.tool === EDITOR_TOOLS.STAIR && this.editor.stairPlacement) {
                    const { x, y, direction } = this.editor.stairPlacement;
                    this.placeStair(x, y, direction);
                    this.editor.stairPlacement = null;
                    this.drawEditor();
                    this.editor.isDragging = false;
                    this.editor.didDrag = false;
                    return;
                }

                // 如果没有发生拖动，则视为单击事件
                if (this.editor.isDragging && !this.editor.didDrag) {
                    const pos = this.getMousePos(e);
                    const cx = Math.floor(pos.x / this.cellSize);
                    const cy = Math.floor(pos.y / this.cellSize);

                    // 修改：移除了 Grid Tool 在此处的逻辑
                    // 因为 MouseDown 已经处理了第一次点击的添加/删除，
                    // 这里再处理会导致状态反转（即添加后立即删除），看起来像没反应。
                    
                    const wall = this.getWallAtPos(pos.x, pos.y);
                    if (wall && this.isWallEditable(wall)) {
                        if (this.editor.tool === EDITOR_TOOLS.DOOR) {
                            if (wall.type === 'h') {
                                const currentType = this.hWalls[wall.y][wall.x].type;
                                this.hWalls[wall.y][wall.x] = { type: currentType === WALL_TYPES.DOOR ? WALL_TYPES.EMPTY : WALL_TYPES.DOOR, keys: 0 };
                            } else {
                                const currentType = this.vWalls[wall.y][wall.x].type;
                                this.vWalls[wall.y][wall.x] = { type: currentType === WALL_TYPES.DOOR ? WALL_TYPES.EMPTY : WALL_TYPES.DOOR, keys: 0 };
                            }
                        } else if (this.editor.tool === EDITOR_TOOLS.LOCK) {
                            const numStr = prompt('请输入锁需要的钥匙数量:', '0');
                            if (numStr !== null) {
                                const keys = parseInt(numStr);
                                if (!isNaN(keys) && keys >= 0) {
                                    if (wall.type === 'h') this.hWalls[wall.y][wall.x] = { type: WALL_TYPES.LOCKED, keys: keys };
                                    else this.vWalls[wall.y][wall.x] = { type: WALL_TYPES.LOCKED, keys: keys };
                                } else {
                                    this.showToast('请输入一个有效的非负整数。', 3000, 'error');
                                }
                            }
                        } else if (this.editor.tool === EDITOR_TOOLS.LETTER_DOOR) { 
                            const wallRef = wall.type === 'h' ? this.hWalls[wall.y][wall.x] : this.vWalls[wall.y][wall.x];
                            if (wallRef.type === WALL_TYPES.LETTER_DOOR) {
                                wallRef.initialState = (wallRef.initialState === 'open') ? 'closed' : 'open';
                            } else {
                                const letter = prompt('请输入一个字母:', 'A');
                                if (letter && /^[a-zA-Z]$/.test(letter)) {
                                    const newWall = { type: WALL_TYPES.LETTER_DOOR, letter: letter.toUpperCase(), initialState: 'closed' };
                                    if (wall.type === 'h') this.hWalls[wall.y][wall.x] = newWall;
                                    else this.vWalls[wall.y][wall.x] = newWall;
                                } else if (letter !== null) {
                                    this.showToast('请输入单个英文字母。', 3000, 'error');
                                }
                            }
                        }
                    }
                    
                    // 处理按钮工具的点击
                    if (this.editor.tool === EDITOR_TOOLS.BUTTON) {
                        const hotspot = this.getButtonHotspotAtPos(pos.x, pos.y);
                        if (hotspot && this.activeCells[hotspot.y][hotspot.x]) {
                            const existingButtonIndex = this.buttons.findIndex(b => b.x === hotspot.x && b.y === hotspot.y && b.direction.dx === hotspot.direction.dx && b.direction.dy === hotspot.direction.dy);
                            if (existingButtonIndex > -1) {
                                this.buttons.splice(existingButtonIndex, 1);
                            } else {
                                const letter = prompt('请输入一个字母:', 'A');
                                if (letter && /^[a-zA-Z]$/.test(letter)) {
                                    this.buttons.push({ ...hotspot, letter: letter.toUpperCase() });
                                } else if (letter !== null) {
                                    this.showToast('请输入单个英文字母。', 3000, 'error');
                                }
                            }
                        }
                    }

                    // 处理在格子上放置实体的逻辑
                    if (cx >= 0 && cx < this.width && cy >= 0 && cy < this.height && this.activeCells[cy][cx]) {
                        const allowed = this.editor.mode === 'free' ? true : !this.isPosInStartRoom(cx, cy);

                        if (allowed) {
                            const existingItemIndex = this.items.findIndex(i => i.x === cx && i.y === cy);
                            const isOccupied = this.isCellOccupiedInEditor(cx, cy);

                            switch (this.editor.tool) {
                                case EDITOR_TOOLS.END:
                                    if (!isOccupied || (this.endPos && this.endPos.x === cx && this.endPos.y === cy)) {
                                        this.endPos = { x: cx, y: cy };
                                    }
                                    break;
                                case EDITOR_TOOLS.START: 
                                    if (this.editor.mode === 'free') {
                                        if (!isOccupied || (this.customStartPos && this.customStartPos.x === cx && this.customStartPos.y === cy)) {
                                            this.customStartPos = { x: cx, y: cy };
                                        }
                                    }
                                    break;
                                case EDITOR_TOOLS.GHOST:
                                    const existingGhostIndex = this.ghosts.findIndex(g => g.x === cx && g.y === cy);
                                    if (existingGhostIndex > -1) this.ghosts.splice(existingGhostIndex, 1);
                                    else if (!isOccupied) this.ghosts.push({ x: cx, y: cy });
                                    break;
                                case EDITOR_TOOLS.KEY:
                                    if (existingItemIndex > -1 && this.items[existingItemIndex].type === 'key') this.items.splice(existingItemIndex, 1);
                                    else if (!isOccupied) this.items.push({ x: cx, y: cy, type: 'key' });
                                    break;
                            }
                        }
                    }
                    this.drawEditor();
                }
                
                this.editor.isDragging = false;
                this.editor.didDrag = false;
                this.editor.dragAxis = null;
                this.editor.lastDragPos = null;
            }
            
            /**
             * 处理鼠标离开Canvas的事件，重置编辑器状态
             */
            handleCanvasMouseLeave(e) {
                if (this.editor.hoveredWall) {
                    this.editor.hoveredWall = null;
                    this.drawEditor();
                }
                this.editor.dragAxis = null;
                this.editor.lastDragPos = null;
            }
            
            /**
             * 根据鼠标坐标获取其附近的墙体
             */
            getWallAtPos(mouseX, mouseY) {
                const cs = this.cellSize;
                const tolerance = cs / 5;
                const gridX = mouseX / cs;
                const gridY = mouseY / cs;
                const x = Math.floor(gridX);
                const y = Math.floor(gridY);
                
                const nearHorizontal = Math.abs(gridY - Math.round(gridY)) * cs < tolerance;
                const nearVertical = Math.abs(gridX - Math.round(gridX)) * cs < tolerance;
                
                if (nearHorizontal && !nearVertical) return { type: 'h', x: x, y: Math.round(gridY) };
                if (nearVertical && !nearHorizontal) return { type: 'v', x: Math.round(gridX), y: y };
                return null;
            }
            
            /**
             * [编辑器] 根据鼠标坐标获取其所在的按钮热点区域
             * @returns {object|null} 热点信息或null
             */
            getButtonHotspotAtPos(mouseX, mouseY) {
                const cs = this.cellSize;
                let cellX = Math.floor(mouseX / cs);
                let cellY = Math.floor(mouseY / cs);

                // 辅助：检查坐标是否在地图范围内
                const isValidCell = (cx, cy) => cx >= 0 && cx < this.width && cy >= 0 && cy < this.height;

                // 如果当前点击的是无效格子（例如边缘墙的外侧），尝试修正到相邻的有效格子
                if (!isValidCell(cellX, cellY)) {
                    const localX = mouseX - cellX * cs;
                    const localY = mouseY - cellY * cs;
                    const tolerance = cs * 0.3; // 容差范围

                    if (localX > cs - tolerance && isValidCell(cellX + 1, cellY)) cellX++;
                    else if (localX < tolerance && isValidCell(cellX - 1, cellY)) cellX--;
                    else if (localY > cs - tolerance && isValidCell(cellX, cellY + 1)) cellY++;
                    else if (localY < tolerance && isValidCell(cellX, cellY - 1)) cellY--;
                    else return null; // 无法修正到有效格子
                }

                // 再次检查修正后的格子是否有效（且不是虚空）
                if (!isValidCell(cellX, cellY) || !this.activeCells[cellY][cellX]) return null;

                // 鼠标在单元格内的相对坐标
                const localX = mouseX - cellX * cs;
                const localY = mouseY - cellY * cs;

                let direction = null;
                // 使用对角线划分四个三角形区域
                if (localY < localX && localY < -localX + cs) {
                    direction = { dx: 0, dy: -1 }; // Top
                } else if (localY > localX && localY > -localX + cs) {
                    direction = { dx: 0, dy: 1 }; // Bottom
                } else if (localY > localX && localY < -localX + cs) {
                    direction = { dx: -1, dy: 0 }; // Left
                } else if (localY < localX && localY > -localX + cs) {
                    direction = { dx: 1, dy: 0 }; // Right
                }

                if (!direction) return null;

                // 新增：辅助函数，安全地检查一个格子是否为 active
                const isActive = (x, y) => {
                    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
                    return this.activeCells[y][x];
                };

                // 重写墙体检查逻辑
                let isAttachable = false;
                if (direction.dy === -1) { // Top
                    const isSolid = this.hWalls[cellY][cellX].type === WALL_TYPES.SOLID;
                    const isBoundary = isActive(cellX, cellY) && !isActive(cellX, cellY - 1);
                    if (isSolid || isBoundary) isAttachable = true;
                } else if (direction.dy === 1) { // Bottom
                    const isSolid = this.hWalls[cellY + 1][cellX].type === WALL_TYPES.SOLID;
                    const isBoundary = isActive(cellX, cellY) && !isActive(cellX, cellY + 1);
                    if (isSolid || isBoundary) isAttachable = true;
                } else if (direction.dx === -1) { // Left
                    const isSolid = this.vWalls[cellY][cellX].type === WALL_TYPES.SOLID;
                    const isBoundary = isActive(cellX, cellY) && !isActive(cellX - 1, cellY);
                    if (isSolid || isBoundary) isAttachable = true;
                } else if (direction.dx === 1) { // Right
                    const isSolid = this.vWalls[cellY][cellX + 1].type === WALL_TYPES.SOLID;
                    const isBoundary = isActive(cellX, cellY) && !isActive(cellX + 1, cellY);
                    if (isSolid || isBoundary) isAttachable = true;
                }
                
                if (isAttachable) {
                    // 检查这堵墙是否是起始房间的边界墙
                    const roomYStart = this.height - 3;
                    const isTopBoundary = direction.dy === -1 && cellY === roomYStart && cellX >= 0 && cellX < 3;
                    const isRightBoundary = direction.dx === 1 && cellX === 2 && cellY >= roomYStart && cellY < this.height;

                    // 如果是起始房间的边界墙，则不允许放置按钮 (仅在 Regular Mode)
                    if (this.editor.mode === 'regular' && (isTopBoundary || isRightBoundary)) {
                        return null;
                    }

                    return { x: cellX, y: cellY, direction: direction };
                }
                return null;
            }

            /**
             * 切换指定墙体的类型（开/关）
             */
            toggleWall(wall, targetType = WALL_TYPES.SOLID) {
                const {x, y, type} = wall;
                if (type === 'h' && y >= 0 && y <= this.height && x >= 0 && x < this.width) {
                    this.hWalls[y][x].type = this.hWalls[y][x].type === targetType ? WALL_TYPES.EMPTY : targetType;
                } else if (type === 'v' && x >= 0 && x <= this.width && y >= 0 && y < this.height) {
                    this.vWalls[y][x].type = this.vWalls[y][x].type === targetType ? WALL_TYPES.EMPTY : targetType;
                }
                this.drawEditor();
            }

            // ==================================================
            //  工具函数 (寻路, 分享码等)
            // ==================================================
            
            /**
             * 判断鼠标在墙体的哪一侧，用于确定单向门的方向
             */
            getMouseSideOfWall(mouseX, mouseY, wall) {
                const cs = this.cellSize;
                if (wall.type === 'h') {
                    return (mouseY > wall.y * cs) ? { dx: 0, dy: 1 } : { dx: 0, dy: -1 };
                } else {
                    return (mouseX > wall.x * cs) ? { dx: 1, dy: 0 } : { dx: -1, dy: 0 };
                }
            }

            /**
             * 使用广度优先搜索(BFS)计算从起点到地图上所有点的最短距离
             */
            calculateDistances(startNode) {
                const distances = Array(this.height).fill(null).map(() => Array(this.width).fill(Infinity));
                const queue = [{ x: startNode.x, y: startNode.y, dist: 0 }];
                distances[startNode.y][startNode.x] = 0;

                while (queue.length > 0) {
                    const { x, y, dist } = queue.shift();
                    const neighbors = [ {dx:0, dy:-1}, {dx:1, dy:0}, {dx:0, dy:1}, {dx:-1, dy:0} ];
                    for (const {dx, dy} of neighbors) {
                        const nx = x + dx;
                        const ny = y + dy;
                        
                        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
                            let wall;
                            if (dx === 1) wall = this.vWalls[y][x + 1];
                            if (dx === -1) wall = this.vWalls[y][x];
                            if (dy === 1) wall = this.hWalls[y + 1][x];
                            if (dy === -1) wall = this.hWalls[y][x];

                            if (wall && [WALL_TYPES.SOLID, WALL_TYPES.LOCKED, WALL_TYPES.ONE_WAY].includes(wall.type)) continue;
                            
                            if (distances[ny][nx] === Infinity) {
                                distances[ny][nx] = dist + 1;
                                queue.push({ x: nx, y: ny, dist: dist + 1 });
                            }
                        }
                    }
                }
                return distances;
            }
            
            /**
             * 使用BFS为鬼寻找通往目标的最短路径 (不考虑门的状态)
             */
            findShortestPath(start, end) {
                const queue = [[{x: start.x, y: start.y}]];
                const visited = new Set([`${start.x},${start.y}`]);

                while (queue.length > 0) {
                    const path = queue.shift();
                    const { x, y } = path[path.length - 1];

                    if (x === end.x && y === end.y) return path;

                    const neighbors = [ {dx:0, dy:-1}, {dx:1, dy:0}, {dx:0, dy:1}, {dx:-1, dy:0} ];
                    for (const {dx, dy} of neighbors) {
                        const nx = x + dx;
                        const ny = y + dy;
                        const key = `${nx},${ny}`;

                        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height && !visited.has(key)) {
                            let wall;
                            if (dx === 1) wall = this.vWalls[y][x + 1];
                            else if (dx === -1) wall = this.vWalls[y][x];
                            else if (dy === 1) wall = this.hWalls[y + 1][x];
                            else if (dy === -1) wall = this.hWalls[y][x];

                            if (wall && wall.type > 0 && !(wall.type === WALL_TYPES.LETTER_DOOR && wall.currentState === 'open')) {
                                continue;
                            }
                            
                            visited.add(key);
                            const newPath = [...path, {x: nx, y: ny}];
                            queue.push(newPath);
                        }
                    }
                }
                return null;
            }

            /**
             * 使用BFS为玩家寻找通往目标的最短路径 (考虑视野和门的状态)
             */
            findPlayerPath(start, end) {
                const queue = [[{x: start.x, y: start.y}]];
                const visited = new Set([`${start.x},${start.y}`]);

                while (queue.length > 0) {
                    const path = queue.shift();
                    const { x, y } = path[path.length - 1];

                    if (x === end.x && y === end.y) return path;

                    const neighbors = [ {dx:0, dy:-1}, {dx:1, dy:0}, {dx:0, dy:1}, {dx:-1, dy:0} ];
                    for (const {dx, dy} of neighbors) {
                        const nx = x + dx;
                        const ny = y + dy;
                        const key = `${nx},${ny}`;

                        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height && !visited.has(key)) {
                            if (!this.seenCells[ny][nx] && !this.debugVision) continue;
                            
                            let wall;
                            let isBlocked = false;
                            if (dx === 1) wall = this.vWalls[y][x + 1];
                            else if (dx === -1) wall = this.vWalls[y][x];
                            else if (dy === 1) wall = this.hWalls[y + 1][x];
                            else if (dy === -1) wall = this.hWalls[y][x];

                            if (wall) {
                                if (wall.type === WALL_TYPES.SOLID || wall.type === WALL_TYPES.GLASS || (wall.type === WALL_TYPES.LOCKED && this.player.keys < wall.keys)) {
                                    isBlocked = true;
                                } else if (wall.type === WALL_TYPES.ONE_WAY) {
                                    if (dx !== wall.direction.dx || dy !== wall.direction.dy) {
                                        isBlocked = true;
                                    }
                                }
                            }
                            if (isBlocked) continue;
                            
                            visited.add(key);
                            const newPath = [...path, {x: nx, y: ny}];
                            queue.push(newPath);
                        }
                    }
                }
                return null;
            }           
            
            /**
             * [私有] 从剪贴板读取文本并调用加载函数
             * @param {boolean} isEditor - 是否加载到编辑器
             */
            async _loadCodeFromClipboard(isEditor = false) {
                try {
                    const code = await navigator.clipboard.readText();
                    if (code) {
                        this.loadFromShareCode(code, isEditor);
                    } else {
                        this.showToast('剪贴板为空。', 3000, 'error');
                    }
                } catch (err) {
                    console.error('无法读取剪贴板内容: ', err);
                    this.showToast('无法读取剪贴板。请检查浏览器权限。', 3000, 'error');
                }
            }

            /**
             * 生成【极致压缩】的分享码
             * 优化 1: 使用 4-bit (Nibble) 存储墙体类型，体积减半
             * 优化 2: 使用 deflateRaw 去除头部开销
             * 优化 3: 使用 URL-Safe Base64 避免地址栏转义膨胀
             */
            generateShareCode(isEditor = false) {
                try {
                    // 1. 收集数据
                    let sourceData;
                    if (isEditor) {
                        sourceData = {
                            width: this.width, height: this.height,
                            hWalls: this.hWalls, vWalls: this.vWalls,
                            endPos: this.endPos, initialGhosts: this.ghosts, items: this.items,
                            buttons: this.buttons,
                            gameMode: this.gameMode,
                            initialHealth: parseInt(document.getElementById('editor-initial-health').value) || 5,
                            initialStamina: parseInt(document.getElementById('editor-initial-stamina').value) || 100,
                            activeCells: this.activeCells,
                            editorMode: this.editor.mode,
                            customStartPos: this.customStartPos
                        };
                    } else {
                        if (!this.mapData) return null;
                        sourceData = {
                            width: this.mapData.width, height: this.mapData.height,
                            hWalls: this.mapData.hWalls, vWalls: this.mapData.vWalls,
                            endPos: this.mapData.endPos, initialGhosts: this.mapData.initialGhosts, items: this.mapData.items,
                            buttons: this.mapData.buttons || [],
                            gameMode: this.gameMode, initialHealth: this.initialHealth, initialStamina: this.initialStamina,
                            activeCells: this.mapData.activeCells || Array(this.mapData.height).fill(null).map(()=>Array(this.mapData.width).fill(true)),
                            editorMode: this.mapData.editorMode || 'regular',
                            customStartPos: this.mapData.customStartPos
                        };
                    }

                    const buffer = [];
                    
                    // 2. 写入头部
                    buffer.push(sourceData.width);
                    buffer.push(sourceData.height);
                    
                    // Mode Byte: Bit 0: 0=Exploration, 1=Loop; Bit 1: 0=Regular, 1=Free
                    let modeByte = (sourceData.gameMode === 'exploration' ? 0 : 1);
                    if (sourceData.editorMode === 'free') modeByte |= 2;
                    buffer.push(modeByte);
                    
                    buffer.push(sourceData.initialHealth);
                    buffer.push((sourceData.initialStamina >> 8) & 0xFF);
                    buffer.push(sourceData.initialStamina & 0xFF);

                    if (sourceData.endPos) {
                        buffer.push(sourceData.endPos.x, sourceData.endPos.y);
                    } else {
                        buffer.push(0xFF, 0xFF);
                    }

                    // 新增：自由模式特有数据 (Custom Start + Active Cells Bitmask)
                    if (sourceData.editorMode === 'free') {
                        if (sourceData.customStartPos) {
                            buffer.push(sourceData.customStartPos.x, sourceData.customStartPos.y);
                        } else {
                            buffer.push(0xFF, 0xFF); // Should be validated before, but safe fallback
                        }
                        // Bit-pack active cells (Row by row)
                        let bits = 0, bitCount = 0;
                        for(let y=0; y<sourceData.height; y++) {
                            for(let x=0; x<sourceData.width; x++) {
                                if (sourceData.activeCells[y][x]) bits |= (1 << bitCount);
                                bitCount++;
                                if (bitCount === 8) {
                                    buffer.push(bits);
                                    bits = 0;
                                    bitCount = 0;
                                }
                            }
                        }
                        if (bitCount > 0) buffer.push(bits); // Remaining bits
                    }

                    // 3. 写入实体 (同上一版)
                    const pushEntities = (list, serializeFn) => {
                        buffer.push(list.length);
                        list.forEach(serializeFn);
                    };
                    pushEntities(sourceData.initialGhosts, g => buffer.push(g.x, g.y));
                    pushEntities(sourceData.items, i => buffer.push(i.x, i.y));
                    pushEntities(sourceData.buttons, b => {
                        buffer.push(b.x, b.y);
                        let dir = 0;
                        if (b.direction.dy === -1) dir = 0;
                        else if (b.direction.dy === 1) dir = 1;
                        else if (b.direction.dx === -1) dir = 2;
                        else dir = 3;
                        buffer.push(dir);
                        buffer.push(b.letter.charCodeAt(0));
                    });

                    // 4. 【核心优化】墙体分离：类型压缩 + 参数队列
                    const typeNibbles = []; // 存储 4-bit 的类型
                    const paramsQueue = []; // 存储额外参数

                    const processWall = (wall) => {
                        typeNibbles.push(wall.type);
                        
                        // 如果墙体有额外参数，推入参数队列
                        if (wall.type === 3) { // LOCKED
                            paramsQueue.push(wall.keys); 
                        } else if (wall.type === 4) { // ONE_WAY
                            let dir = 0;
                            if (wall.direction.dy === -1) dir = 0;
                            else if (wall.direction.dy === 1) dir = 1;
                            else if (wall.direction.dx === -1) dir = 2;
                            else dir = 3;
                            paramsQueue.push(dir);
                        } else if (wall.type === 6) { // LETTER_DOOR
                            paramsQueue.push(wall.letter.charCodeAt(0));
                            paramsQueue.push(wall.initialState === 'open' ? 1 : 0);
                        }
                    };

                    // 遍历顺序必须严格一致：先横后竖，先左后右
                    for (let y = 0; y <= sourceData.height; y++) {
                        for (let x = 0; x < sourceData.width; x++) processWall(sourceData.hWalls[y][x]);
                    }
                    for (let y = 0; y < sourceData.height; y++) {
                        for (let x = 0; x <= sourceData.width; x++) processWall(sourceData.vWalls[y][x]);
                    }

                    // 5. 【核心优化】Bit-Packing：将两个 4-bit 类型合并为一个字节
                    for (let i = 0; i < typeNibbles.length; i += 2) {
                        const t1 = typeNibbles[i];
                        const t2 = (i + 1 < typeNibbles.length) ? typeNibbles[i + 1] : 0;
                        buffer.push((t1 << 4) | t2);
                    }

                    // 6. 追加参数数据
                    paramsQueue.forEach(p => buffer.push(p));

                    // 7. 【核心优化】DeflateRaw + URL-Safe Base64
                    const uint8Data = new Uint8Array(buffer);
                    // 使用 deflateRaw 去除 zlib 头 (节省约 6 字节)
                    const compressed = pako.deflateRaw(uint8Data);
                    
                    let binaryString = '';
                    const len = compressed.byteLength;
                    for (let i = 0; i < len; i++) {
                        binaryString += String.fromCharCode(compressed[i]);
                    }
                    
                    // URL Safe 替换: +->- , /->_ , 去掉 =
                    const base64 = btoa(binaryString)
                        .replace(/\+/g, '-')
                        .replace(/\//g, '_')
                        .replace(/=+$/, '');
                    
                    return base64;

                } catch (e) {
                    console.error("Share code gen failed", e);
                    this.showToast('生成分享码失败', 3000, 'error');
                    return null;
                }
            }

            /**
             * 加载【极致压缩】的分享码
             * 兼容性：
             * 1. 优先尝试解析新版 (Nibble + DeflateRaw + URLSafe)
             * 2. 失败则回退尝试解析旧版 JSON
             */
            loadFromShareCode(code, isEditor = false) {
                if (!code) {
                    this.showToast('请输入分享码。', 3000, 'error');
                    return;
                }
                try {
                    // 1. URL-Safe Base64 还原
                    // 替换回标准字符，并补全 padding
                    let base64 = code.replace(/-/g, '+').replace(/_/g, '/');
                    while (base64.length % 4) {
                        base64 += '=';
                    }

                    const binaryString = atob(base64);
                    const len = binaryString.length;
                    const bytes = new Uint8Array(len);
                    for (let i = 0; i < len; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }

                    // 2. 解压
                    let inflated;
                    let isLegacyJson = false;

                    try {
                        // 尝试作为新版 (Raw) 解压
                        inflated = pako.inflateRaw(bytes);
                    } catch (e) {
                        try {
                            // 失败则尝试作为标准 Zlib 解压 (兼容中间版本)
                            inflated = pako.inflate(bytes);
                        } catch (e2) {
                            // 还是失败，可能是未压缩的 JSON (极旧版本)
                            // 但这里我们主要检查解压后是否是JSON
                            throw new Error("Decompression failed");
                        }
                    }

                    // 3. 检测内容类型
                    if (inflated[0] === 123) { // ASCII '{'
                        isLegacyJson = true;
                    }

                    // === 旧版 JSON 处理逻辑 ===
                    if (isLegacyJson) {
                        const jsonString = new TextDecoder().decode(inflated);
                        const data = JSON.parse(jsonString);
                        const mapData = {
                            width: data.w, height: data.h,
                            hWalls: data.hw, vWalls: data.vw,
                            endPos: data.e || null,
                            initialGhosts: data.g || [],
                            items: data.i || [],
                            buttons: data.b || [],
                            // Legacy maps default to regular
                            activeCells: Array(data.h).fill(null).map(()=>Array(data.w).fill(true)),
                            editorMode: 'regular',
                            customStartPos: null
                        };
                        this._applyLoadedData(mapData, data.gm, data.ih, data.is, isEditor);
                        return;
                    }

                    // === 新版极致压缩 处理逻辑 ===
                    let ptr = 0;
                    const read = () => inflated[ptr++];
                    
                    const width = read();
                    const height = read();
                    const modeByte = read();
                    const gameMode = (modeByte & 1) === 0 ? 'exploration' : 'death-loop';
                    const editorMode = (modeByte & 2) === 0 ? 'regular' : 'free';
                    
                    const initialHealth = read();
                    const staminaHigh = read();
                    const staminaLow = read();
                    const initialStamina = (staminaHigh << 8) | staminaLow;

                    let endPos = null;
                    const ex = read();
                    const ey = read();
                    if (ex !== 0xFF) endPos = { x: ex, y: ey };

                    // Free Mode Data Unpacking
                    let customStartPos = null;
                    let activeCells = null;

                    if (editorMode === 'free') {
                        const csx = read();
                        const csy = read();
                        if (csx !== 0xFF) customStartPos = { x: csx, y: csy };

                        activeCells = [];
                        let bits = 0, bc = 0;
                        for(let y=0; y<height; y++) {
                            const row = [];
                            for(let x=0; x<width; x++) {
                                if (bc === 0) { bits = read(); bc = 0; }
                                const val = (bits & (1 << bc)) !== 0;
                                row.push(val);
                                bc++; if (bc===8) bc=0;
                            }
                            activeCells.push(row);
                        }
                    }

                    // 实体读取
                    const readEntities = (createFn) => {
                        const count = read();
                        const list = [];
                        for(let i=0; i<count; i++) list.push(createFn());
                        return list;
                    };

                    const initialGhosts = readEntities(() => ({ x: read(), y: read() }));
                    const items = readEntities(() => ({ x: read(), y: read(), type: 'key' }));
                    const buttons = readEntities(() => {
                        const x = read();
                        const y = read();
                        const dirCode = read();
                        const letter = String.fromCharCode(read());
                        let direction = {dx:0, dy:0};
                        if (dirCode === 0) direction = {dx:0, dy:-1};
                        else if (dirCode === 1) direction = {dx:0, dy:1};
                        else if (dirCode === 2) direction = {dx:-1, dy:0};
                        else direction = {dx:1, dy:0};
                        return { x, y, direction, letter };
                    });

                    // 计算压缩包中 PackedTypes 区域的长度
                    // 横墙数: (H+1)*W, 竖墙数: H*(W+1)
                    const totalWalls = (height + 1) * width + height * (width + 1);
                    const packedBytesLen = Math.ceil(totalWalls / 2);

                    // 提取 PackedTypes 区域
                    const packedTypes = inflated.subarray(ptr, ptr + packedBytesLen);
                    ptr += packedBytesLen;

                    // 辅助函数：从 PackedTypes 中获取第 n 个墙的类型
                    const getWallType = (index) => {
                        const byteIndex = Math.floor(index / 2);
                        const byte = packedTypes[byteIndex];
                        // 如果是偶数个(0, 2...), 取高4位；奇数个(1, 3...), 取低4位
                        if (index % 2 === 0) return (byte >> 4) & 0x0F;
                        else return byte & 0x0F;
                    };

                    let wallCounter = 0;

                    const readNextWall = () => {
                        const type = getWallType(wallCounter++);
                        const wall = { type: type, keys: 0 };
                        
                        // 如果类型需要参数，则从 ptr 继续读取 (参数存储在 PackedTypes 之后)
                        if (type === 3) { // LOCKED
                            wall.keys = read();
                        } else if (type === 4) { // ONE_WAY
                            const d = read();
                            if (d === 0) wall.direction = {dx:0, dy:-1};
                            else if (d === 1) wall.direction = {dx:0, dy:1};
                            else if (d === 2) wall.direction = {dx:-1, dy:0};
                            else wall.direction = {dx:1, dy:0};
                        } else if (type === 6) { // LETTER_DOOR
                            wall.letter = String.fromCharCode(read());
                            const s = read();
                            wall.initialState = s === 1 ? 'open' : 'closed';
                            wall.currentState = wall.initialState;
                        }
                        return wall;
                    };

                    // 重建墙体数组
                    const hWalls = [];
                    for(let y=0; y<=height; y++) {
                        const row = [];
                        for(let x=0; x<width; x++) row.push(readNextWall());
                        hWalls.push(row);
                    }
                    
                    const vWalls = [];
                    for(let y=0; y<height; y++) {
                        const row = [];
                        for(let x=0; x<=width; x++) row.push(readNextWall());
                        vWalls.push(row);
                    }

                    const mapData = {
                        width, height, hWalls, vWalls, endPos, initialGhosts, items, buttons,
                        editorMode: editorMode,
                        customStartPos: customStartPos,
                        activeCells: activeCells
                    };

                    this._applyLoadedData(mapData, gameMode, initialHealth, initialStamina, isEditor);

                } catch (e) {
                    console.error("Load failed", e);
                    this.showToast('分享码无效或已损坏。', 3000, 'error');
                }
            }

            /**
             * 内部辅助：应用加载的数据到游戏或编辑器
             */
            _applyLoadedData(mapData, gameMode, health, stamina, isEditor) {
                 if (isEditor) {
                    this.setGameMode(gameMode, true); 
                    document.getElementById('editor-initial-health').value = health;
                    document.getElementById('editor-initial-stamina').value = stamina;

                    this.width = mapData.width;
                    this.height = mapData.height;
                    this.startPos = { x: 1, y: this.height - 2 };
                    this.editorMapSizeInput.value = this.width;
                    this.cellSize = canvas.width / this.width;
                    this.hWalls = mapData.hWalls;
                    this.vWalls = mapData.vWalls;
                    this.endPos = mapData.endPos;
                    this.ghosts = mapData.initialGhosts;
                    this.items = mapData.items;
                    this.buttons = mapData.buttons || [];
                    
                    // 扩展属性加载
                    this.activeCells = mapData.activeCells || Array(this.height).fill(null).map(()=>Array(this.width).fill(true));
                    this.editor.mode = mapData.editorMode || 'regular';
                    this.customStartPos = mapData.customStartPos;

                    this.mapData = { // 更新当前的 mapData，确保 reset/play 正确
                        ...mapData,
                        hWalls: JSON.parse(JSON.stringify(this.hWalls)),
                        vWalls: JSON.parse(JSON.stringify(this.vWalls))
                    };

                    this.updateEditorUIForMode(); // 更新UI状态
                    this._renderStaticLayer();
                    this.drawEditor();
                } else {
                    this.initialHealth = health;
                    this.initialStamina = stamina;
                    this.setGameMode(gameMode);
                    this.startGame(mapData);
                }
                this.showToast('地图加载成功！', 2000, 'success');
            }

            // ==================================================
            //  历史与撤销系统
            // ==================================================

            /**
             * 创建当前游戏状态的快照
             * @param {boolean} isRevivalPoint - 是否为复活点/存档点
             * @returns {object} 状态快照对象
             */
            createSnapshot(isRevivalPoint = false) {
                return {
                    player: JSON.parse(JSON.stringify(this.player)),
                    ghosts: JSON.parse(JSON.stringify(this.ghosts)),
                    items: JSON.parse(JSON.stringify(this.items)),
                    // 墙体状态需要深拷贝，特别是字母门的currentState
                    hWalls: JSON.parse(JSON.stringify(this.hWalls)),
                    vWalls: JSON.parse(JSON.stringify(this.vWalls)),
                    isRevivalPoint: isRevivalPoint
                };
            }

            /**
             * 从快照恢复游戏状态
             * @param {object} snapshot - 状态快照对象
             */
            loadFromSnapshot(snapshot) {
                this.player = JSON.parse(JSON.stringify(snapshot.player));
                this.ghosts = JSON.parse(JSON.stringify(snapshot.ghosts));
                this.items = JSON.parse(JSON.stringify(snapshot.items));
                this.hWalls = JSON.parse(JSON.stringify(snapshot.hWalls));
                this.vWalls = JSON.parse(JSON.stringify(snapshot.vWalls));
                
                this.updateUIDisplays();
                this.draw();
            }

            /**
             * 记录当前状态到历史记录中
             * @param {boolean} isRevivalPoint - 当前状态是否为复活点
             */
            recordHistory(isRevivalPoint = false) {
                // 如果在撤销后走了新的分支，则截断旧的未来历史
                if (this.currentStep < this.history.length - 1) {
                    this.history = this.history.slice(0, this.currentStep + 1);
                    this.checkpoints = this.checkpoints.filter(cp => cp <= this.currentStep);
                }
                
                const snapshot = this.createSnapshot(isRevivalPoint);
                this.history.push(snapshot);
                this.currentStep++;
                
                this.updateHistoryButtons();
            }

            /**
             * 更新撤销、存档、回溯按钮的可用状态
             */
            updateHistoryButtons() {
                const undoBtn = document.getElementById('undo-btn');
                const saveBtn = document.getElementById('save-btn');
                const rewindBtn = document.getElementById('rewind-btn');

                // 只有在当前步数不是第一步且不是复活点时才能撤销
                const canUndo = this.currentStep > 0 && !this.history[this.currentStep].isRevivalPoint;
                undoBtn.disabled = !canUndo;

                // 只有在当前步数比上一个存档点更晚时才能存档
                const lastCheckpoint = this.checkpoints.length > 0 ? this.checkpoints[this.checkpoints.length - 1] : -1;
                const canSave = this.currentStep > lastCheckpoint;
                saveBtn.disabled = !canSave;

                // 只有存在比当前步数更早的存档点时才能回溯
                const canRewind = this.checkpoints.some(cp => cp < this.currentStep);
                rewindBtn.disabled = !canRewind;
            }

            /**
             * 处理撤销操作
             */
            handleUndo() {
                if (this.currentStep <= 0) return;
                if (this.history[this.currentStep].isRevivalPoint) {
                    this.showToast('无法撤回到上一次生命', 2000, 'error');
                    return;
                }
                
                this.currentStep--;
                this.loadFromSnapshot(this.history[this.currentStep]);
                this.updateHistoryButtons();
            }

            /**
             * 处理存档操作
             */
            handleSave() {
                const lastCheckpoint = this.checkpoints.length > 0 ? this.checkpoints[this.checkpoints.length - 1] : -1;
                if (this.currentStep <= lastCheckpoint) {
                    this.showToast('请先移动后再存档', 2000, 'error');
                    return;
                }

                this.checkpoints.push(this.currentStep);
                this.showToast(`已在第 ${this.currentStep} 步创建存档`, 2000, 'success');
                this.updateHistoryButtons();
            }

            /**
             * 处理回溯到上一个存档点的操作
             */
            handleRewind() {
                // 找到所有比当前步数早的存档点
                const availableCheckpoints = this.checkpoints.filter(cp => cp < this.currentStep);
                if (availableCheckpoints.length === 0) {
                    this.showToast('没有更早的存档点可供回溯', 2000, 'error');
                    return;
                }

                // 回溯到最近的一个早期存档点
                const targetStep = Math.max(...availableCheckpoints);
                this.currentStep = targetStep;
                this.loadFromSnapshot(this.history[this.currentStep]);
                this.updateHistoryButtons();
                this.showToast(`已回溯至存档点 (第 ${targetStep} 步)`, 2000, 'success');
            }

            /**
             * 生成分享码并复制到剪贴板
             */
            copyShareCode(isEditor = false) {
                const code = this.generateShareCode(isEditor);
                if (code) {
                    navigator.clipboard.writeText(code).then(() => {
                        this.showToast('分享码已复制到剪贴板！', 2000, 'success');
                    }, () => {
                        this.showToast('复制分享码失败。', 3000, 'error');
                    });
                } else {
                    this.showToast('无法生成分享码，请先创建地图。', 3000, 'error');
                }
            }
        }

        // 创建游戏实例
        const game = new GhostMazeGame();
    });
