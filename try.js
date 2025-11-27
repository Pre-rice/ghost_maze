// ==================================================
//  常量定义
// ==================================================
const WALL_TYPES = { EMPTY: 0, SOLID: 1, DOOR: 2, LOCKED: 3, ONE_WAY: 4, GLASS: 5, LETTER_DOOR: 6 };
const GAME_STATES = { MENU: 'menu', PLAYING: 'playing', EDITOR: 'editor' }; // DEAD and WON are now flags within GameState
const EDITOR_TOOLS = { WALL: 'wall', GLASS: 'glass', DOOR: 'door', ONE_WAY: 'oneway', LOCK: 'lock', LETTER_DOOR: 'letter', BUTTON: 'button', GHOST: 'ghost', KEY: 'key', START: 'start', END: 'end', STAIR: 'stair', ERASER: 'eraser', GRID: 'grid' };

// ==================================================
//  新架构：核心数据结构
// ==================================================

/**
 * MapDefinition: 存储地图的静态、不可变定义。
 * 它像棋盘，定义了游戏的舞台，加载后不再改变。
 */
class MapDefinition {
    constructor(data) {
        this.width = data.width;
        this.height = data.height;
        this.gameMode = data.gameMode || 'exploration';
        this.initialHealth = data.initialHealth || 5;
        this.initialStamina = data.initialStamina || 100;
        this.editorMode = data.editorMode || 'regular';
        this.multiLayerMode = data.multiLayerMode || false;
        this.layerCount = data.layerCount || 1;

        this.layers = [];
        for (let i = 0; i < this.layerCount; i++) {
            const layerData = data.layers[i] || { hWalls: [], vWalls: [], activeCells: [] };
            this.layers.push({
                activeCells: JSON.parse(JSON.stringify(layerData.activeCells)),
                initialWalls: {
                    h: JSON.parse(JSON.stringify(layerData.hWalls)),
                    v: JSON.parse(JSON.stringify(layerData.vWalls))
                },
                initialEntities: {
                    ghosts: JSON.parse(JSON.stringify(layerData.ghosts || [])),
                    items: JSON.parse(JSON.stringify(layerData.items || [])),
                    buttons: JSON.parse(JSON.stringify(layerData.buttons || [])),
                    stairs: JSON.parse(JSON.stringify(layerData.stairs || [])),
                    endPos: layerData.endPos ? { ...layerData.endPos } : null,
                    customStartPos: layerData.customStartPos ? { ...layerData.customStartPos } : null
                }
            });
        }

        this.playerStart = { x: 1, y: this.height - 2, layer: 0 };
        if (this.editorMode === 'free') {
             for (let i = 0; i < this.layerCount; i++) {
                if (this.layers[i].initialEntities.customStartPos) {
                    this.playerStart = { ...this.layers[i].initialEntities.customStartPos, layer: i };
                    break;
                }
            }
        }
    }
}

/**
 * GameState: 存储游戏某一时刻的完整动态快照。
 * 这是一个纯粹的数据对象，代表游戏的一个瞬间。
 */
class GameState {
    constructor(data) {
        this.player = { ...data.player }; // { x, y, layer, hp, stamina, keys, steps }
        this.loopCount = data.loopCount || 0;
        this.isDead = data.isDead || false;
        this.isWon = data.isWon || false;
        this.deathReason = data.deathReason || '';
        this.isRevivalPoint = data.isRevivalPoint || false; // 标记是否为复活点

        this.layerStates = data.layerStates.map(ls => ({
            ghosts: JSON.parse(JSON.stringify(ls.ghosts)),
            items: JSON.parse(JSON.stringify(ls.items)),
            wallStates: {
                h: JSON.parse(JSON.stringify(ls.wallStates.h)),
                v: JSON.parse(JSON.stringify(ls.wallStates.v))
            }
        }));
        
        this.seenCells = JSON.parse(JSON.stringify(data.seenCells)); // boolean[layer][y][x]
    }
    
    clone() {
        // 使用 structuredClone 性能更好，但兼容性稍差。JSON方法足够安全。
        return new GameState(JSON.parse(JSON.stringify(this)));
    }
}


document.addEventListener('DOMContentLoaded', () => {
    // ... (三态主题切换代码保持不变) ...

    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');

    /**
     * GhostMazeGame: 游戏的主控制器。
     * 它管理游戏状态、处理用户输入、并调用渲染。
     * 它本身不包含游戏逻辑，逻辑在 GameLogic 对象中。
     */
    class GhostMazeGame {
        constructor() {
            // ... (DOM元素缓存保持不变) ...
            
            this.toastTimeout = null;
            this.animationFrameId = null;
            this.autoMoveInterval = null;

            this.staticLayerCanvas = document.createElement('canvas');
            this.staticLayerCtx = this.staticLayerCanvas.getContext('2d');
            
            this.updateColors();
            
            // 核心状态管理
            this.gameState = GAME_STATES.MENU;
            this.mapDefinition = null;
            this.history = [];
            this.currentStep = -1;
            this.checkpoints = [];
            this.viewLayer = 0;
            
            // 编辑器状态
            this.editor = { /* ... (编辑器状态保持不变) ... */ };

            this.bindUI();
            this.showInitialMessage();
            this.loadShareCodeFromURL();
        }

        // ... (updateColors, refreshTheme, showInitialMessage, showToast, showConfirm 等UI函数保持不变) ...

        getCurrentState() {
            return this.history[this.currentStep];
        }

        // ==================================================
        //  核心游戏流程 (已重构)
        // ==================================================

        loadShareCodeFromURL() {
            const params = new URLSearchParams(window.location.search);
            let code = params.get("map") || (window.location.hash ? window.location.hash.substring(1) : null);
            if (code) {
                this.showToast("检测到分享码，正在加载…", 2000);
                this.loadFromShareCode(code, false);
            }
        }

        loadFromShareCode(code, isEditor = false) {
            try {
                const mapData = this.parseShareCode(code);
                this.mapDefinition = new MapDefinition(mapData);

                if (isEditor) {
                    // this.enterEditorMode(true); // 编辑器逻辑需要单独适配
                    this.showToast('编辑器加载功能待适配新架构', 3000, 'error');
                } else {
                    const initialState = GameLogic.createInitialState(this.mapDefinition);
                    this.startGame(initialState);
                }
                this.showToast('地图加载成功！', 2000, 'success');
            } catch (e) {
                console.error("Load failed", e);
                this.showToast('分享码无效或已损坏。', 3000, 'error');
            }
        }

        startGame(initialState) {
            this.stopAnimationLoop();
            this.gameState = GAME_STATES.PLAYING;
            this.history = [initialState];
            this.currentStep = 0;
            this.checkpoints = [];
            
            this.viewLayer = initialState.player.layer;
            
            this.hideAllOverlays();
            this.updateUIDisplays();
            this.updateLayerPanel();
            this.render();
            this.startAnimationLoop();
            
            const code = this.generateShareCode();
            this.updateURLWithShareCode(code);
        }

        processAction(action) {
            if (this.gameState !== GAME_STATES.PLAYING) return;
            const currentState = this.getCurrentState();
            if (currentState.isDead || currentState.isWon) return;

            const nextState = GameLogic.calculateNextState(currentState, action, this.mapDefinition);

            if (nextState === currentState) return; // 状态无变化

            if (this.currentStep < this.history.length - 1) {
                this.history = this.history.slice(0, this.currentStep + 1);
                this.checkpoints = this.checkpoints.filter(cp => cp <= this.currentStep);
            }

            this.history.push(nextState);
            this.currentStep++;
            
            this.viewLayer = nextState.player.layer;

            this.render();
            this.updateUIDisplays();
            this.updateLayerPanel();
            this.updateHistoryButtons();

            if (nextState.isDead) this.handlePlayerDeath(nextState);
            if (nextState.isWon) this.handleWin(nextState);
        }

        // ==================================================
        //  视图与渲染 (已重构)
        // ==================================================

        switchToLayer(layerIndex) {
            if (this.viewLayer === layerIndex || !this.mapDefinition) return;
            this.viewLayer = layerIndex;
            this.render();
            this.updateLayerPanel();
        }

        render() {
            if (this.gameState === GAME_STATES.MENU) { this.showInitialMessage(); return; }
            if (this.gameState === GAME_STATES.EDITOR) { this.drawEditor(); return; }

            const currentState = this.getCurrentState();
            if (!currentState || !this.mapDefinition) return;

            const mapDef = this.mapDefinition;
            const viewLayerDef = mapDef.layers[this.viewLayer];
            const viewLayerState = currentState.layerStates[this.viewLayer];
            const cellSize = (canvas.width - 30) / mapDef.width;
            
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.save();
            ctx.translate(15, 15); // Padding

            // 1. 静态背景
            this._renderStaticLayer(viewLayerDef.activeCells, cellSize);
            ctx.drawImage(this.staticLayerCanvas, 0, 0);

            // 2. 战争迷雾
            const seen = currentState.seenCells[this.viewLayer];
            for (let y = 0; y < mapDef.height; y++) {
                for (let x = 0; x < mapDef.width; x++) {
                    if (viewLayerDef.activeCells[y][x] && !seen[y][x] && !this.debugVision) {
                        ctx.fillStyle = this.colors.unexplored;
                        ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
                    }
                }
            }

            // 3. 墙体
            this.drawWalls(viewLayerDef, viewLayerState, seen, cellSize);
            
            // 4. 实体
            this.drawEntities(viewLayerDef, viewLayerState, seen, cellSize);

            // 5. 玩家
            if (currentState.player.layer === this.viewLayer) {
                this.drawCircle(currentState.player.x, currentState.player.y, cellSize, this.colors.player);
            }
            
            ctx.restore();
        }
        
        // ... (具体的绘图辅助函数需要适配，这里省略以保持清晰，但逻辑上它们会接收数据来绘制) ...

        // ==================================================
        //  事件处理 (已重构)
        // ==================================================

        bindUI() {
            // ... (大部分绑定保持不变) ...
            document.getElementById('generate-map-btn').addEventListener('click', () => {
                const size = parseInt(this.mapSizeInput.value);
                // ... (尺寸验证) ...
                const mapData = this.generateMaze(size, size); // generateMaze现在返回mapDef格式
                this.mapDefinition = new MapDefinition(mapData);
                const initialState = GameLogic.createInitialState(this.mapDefinition);
                this.startGame(initialState);
            });

            document.getElementById('reset-map-btn').addEventListener('click', () => {
                if (!this.mapDefinition) return;
                const initialState = GameLogic.createInitialState(this.mapDefinition);
                this.startGame(initialState);
            });

            document.getElementById('revive-btn').addEventListener('click', () => this.processAction({ type: 'REVIVE' }));

            window.addEventListener('keydown', (e) => {
                let action = null;
                switch (e.key) {
                    case 'ArrowUp': case 'w': action = { type: 'MOVE', payload: { dx: 0, dy: -1 } }; break;
                    case 'ArrowDown': case 's': action = { type: 'MOVE', payload: { dx: 0, dy: 1 } }; break;
                    case 'ArrowLeft': case 'a': action = { type: 'MOVE', payload: { dx: -1, dy: 0 } }; break;
                    case 'ArrowRight': case 'd': action = { type: 'MOVE', payload: { dx: 1, dy: 0 } }; break;
                    case ' ': e.preventDefault(); action = { type: 'USE_STAIR' }; break;
                }
                if (action) this.processAction(action);
            });
            // ... (其他按钮也应转换为 processAction) ...
        }

        // ==================================================
        //  历史与撤销 (已重构)
        // ==================================================
        
        handleUndo() {
            if (this.currentStep <= 0 || this.history[this.currentStep].isRevivalPoint) {
                this.showToast('无法撤销到复活点之前', 2000, 'error');
                return;
            }
            
            this.currentStep--;
            const prevState = this.getCurrentState();
            this.viewLayer = prevState.player.layer;
            
            this.render();
            this.updateUIDisplays();
            this.updateHistoryButtons();
        }
        
        // ... (handleSave, handleRewind 逻辑类似) ...

        // ==================================================
        //  分享码 (已重构)
        // ==================================================

        generateShareCode() {
            if (!this.mapDefinition) return null;
            // 逻辑：序列化 this.mapDefinition 对象
            // ... (此处省略复杂的序列化实现，返回一个占位符) ...
            try {
                const jsonString = JSON.stringify(this.mapDefinition);
                const compressed = pako.deflate(jsonString, { to: 'string' });
                return btoa(compressed);
            } catch (e) {
                console.error("Share code generation failed:", e);
                return null;
            }
        }

        parseShareCode(code) {
            const compressed = atob(code);
            const jsonString = pako.inflate(compressed, { to: 'string' });
            return JSON.parse(jsonString);
        }
    }

    // ==================================================
    //  新架构：GameLogic 纯函数模块
    // ==================================================
    
    const GameLogic = {
        createInitialState(mapDef) {
            const layerStates = mapDef.layers.map(layerDef => ({
                ghosts: JSON.parse(JSON.stringify(layerDef.initialEntities.ghosts)),
                items: JSON.parse(JSON.stringify(layerDef.initialEntities.items)),
                wallStates: {
                    h: layerDef.initialWalls.h.map(row => row.map(wall => ({ type: wall.type, currentState: wall.initialState || 'closed' }))),
                    v: layerDef.initialWalls.v.map(row => row.map(wall => ({ type: wall.type, currentState: wall.initialState || 'closed' })))
                }
            }));

            const seenCells = Array(mapDef.layerCount).fill(null).map(() => 
                Array(mapDef.height).fill(null).map(() => Array(mapDef.width).fill(false))
            );

            const initialState = new GameState({
                player: { ...mapDef.playerStart, hp: mapDef.initialHealth, stamina: mapDef.initialStamina, keys: 0, steps: 0 },
                loopCount: 0,
                layerStates: layerStates,
                seenCells: seenCells,
                isRevivalPoint: true // 游戏开始是一个复活点
            });
            
            return this.updateVisibility(initialState, mapDef);
        },

        calculateNextState(currentState, action, mapDef) {
            const nextState = currentState.clone();
            const originalPlayerPos = { ...currentState.player };

            let stateChanged = false;

            if (action.type === 'MOVE') {
                stateChanged = this.handleMove(nextState, action.payload, mapDef);
            } else if (action.type === 'USE_STAIR') {
                stateChanged = this.handleUseStair(nextState, mapDef);
            } else if (action.type === 'PRESS_BUTTON') {
                stateChanged = this.handlePressButton(nextState, action.payload, mapDef);
            } else if (action.type === 'REVIVE') {
                return this.handleRevive(currentState, mapDef);
            }

            if (stateChanged) {
                this.handleItemPickup(nextState, mapDef);
                this.moveGhosts(nextState, originalPlayerPos, mapDef);
                this.checkCollisions(nextState, mapDef);
                this.updateVisibility(nextState, mapDef);
                this.checkWinLossConditions(nextState, mapDef);
                return nextState;
            }
            
            return currentState; // 无变化
        },

        handleMove(state, direction, mapDef) {
            const p = state.player;
            const newPos = { x: p.x + direction.dx, y: p.y + direction.dy, layer: p.layer };

            if (newPos.x < 0 || newPos.x >= mapDef.width || newPos.y < 0 || newPos.y >= mapDef.height) return false;
            if (!mapDef.layers[p.layer].activeCells[newPos.y][newPos.x]) return false;

            const wallDef = this.getWallBetween(p, newPos, mapDef.layers[p.layer].initialWalls);
            const wallState = this.getWallBetween(p, newPos, state.layerStates[p.layer].wallStates);

            if (wallDef) {
                if (wallDef.type === WALL_TYPES.SOLID || wallDef.type === WALL_TYPES.GLASS) return false;
                if (wallDef.type === WALL_TYPES.ONE_WAY && (direction.dx !== wallDef.direction.dx || direction.dy !== wallDef.direction.dy)) return false;
                if (wallDef.type === WALL_TYPES.LOCKED && p.keys < wallDef.keys) return false;
                if (wallDef.type === WALL_TYPES.LETTER_DOOR && wallState.currentState === 'closed') return false;
                
                if (wallDef.type === WALL_TYPES.LOCKED && p.keys >= wallDef.keys) {
                    wallState.type = WALL_TYPES.EMPTY; // 消耗钥匙，门永久打开
                }
            }

            p.x = newPos.x;
            p.y = newPos.y;
            p.steps++;
            if (mapDef.gameMode === 'death-loop') p.stamina--;
            
            return true;
        },

        handleUseStair(state, mapDef) {
            const p = state.player;
            const stairs = mapDef.layers[p.layer].initialEntities.stairs;
            const stair = stairs.find(s => s.x === p.x && s.y === p.y);
            if (!stair) return false;

            const targetLayer = stair.direction === 'up' ? p.layer + 1 : p.layer - 1;
            if (targetLayer < 0 || targetLayer >= mapDef.layerCount) return false;

            const targetStairs = mapDef.layers[targetLayer].initialEntities.stairs;
            const targetStair = targetStairs.find(s => s.x === p.x && s.y === p.y && s.direction !== stair.direction);
            if (!targetStair) return false;

            p.layer = targetLayer;
            p.steps++;
            if (mapDef.gameMode === 'death-loop') p.stamina--;
            return true;
        },

        handleItemPickup(state, mapDef) {
            const p = state.player;
            const items = state.layerStates[p.layer].items;
            const itemIndex = items.findIndex(item => item.x === p.x && item.y === p.y);
            if (itemIndex > -1) {
                const item = items[itemIndex];
                if (item.type === 'key') {
                    p.keys++;
                }
                items.splice(itemIndex, 1);
            }
        },

        moveGhosts(state, oldPlayerPos, mapDef) {
            // 保持原有AI逻辑，但操作的是 state 对象
            const playerLayer = oldPlayerPos.layer;
            const ghosts = state.layerStates[playerLayer].ghosts;
            const walls = {
                defs: mapDef.layers[playerLayer].initialWalls,
                states: state.layerStates[playerLayer].wallStates
            };

            // ... (此处应迁移原有的 canGhostSeePlayer 和 findShortestPath 逻辑) ...
            // ... (为简洁起见，此处省略具体实现，但思路是相同的) ...
        },

        checkCollisions(state, mapDef) {
            const p = state.player;
            const ghosts = state.layerStates[p.layer].ghosts;
            if (ghosts.some(g => g.x === p.x && g.y === p.y)) {
                if (mapDef.gameMode === 'exploration') {
                    p.hp--;
                }
                state.isDead = true;
                state.deathReason = 'ghost';
            }
        },

        updateVisibility(state, mapDef) {
            const p = state.player;
            const seen = state.seenCells[p.layer];
            const walls = mapDef.layers[p.layer].initialWalls;
            const activeCells = mapDef.layers[p.layer].activeCells;

            seen[p.y][p.x] = true;
            // ... (迁移原有射线投射逻辑，操作 seen 和 walls) ...
            return state;
        },

        checkWinLossConditions(state, mapDef) {
            const p = state.player;
            const endPos = mapDef.layers[p.layer].initialEntities.endPos;

            if (endPos && p.x === endPos.x && p.y === endPos.y) {
                state.isWon = true;
            }

            if (mapDef.gameMode === 'exploration' && p.hp <= 0) {
                state.isDead = true;
                state.deathReason = 'no_hp';
            }
            if (mapDef.gameMode === 'death-loop' && p.stamina <= 0) {
                state.isDead = true;
                state.deathReason = 'no_stamina';
            }
        },

        handleRevive(currentState, mapDef) {
            const nextState = currentState.clone();
            if (mapDef.gameMode === 'exploration') {
                if (nextState.player.hp > 0) {
                    nextState.isDead = false;
                    // 回到上一个复活点
                    // (简化逻辑：直接回到出生点)
                    nextState.player.x = mapDef.playerStart.x;
                    nextState.player.y = mapDef.playerStart.y;
                    nextState.player.layer = mapDef.playerStart.layer;
                    nextState.isRevivalPoint = true;
                    return nextState;
                }
            } else { // Death Loop
                const newInitial = this.createInitialState(mapDef);
                newInitial.loopCount = currentState.loopCount + 1;
                newInitial.seenCells = currentState.seenCells; // 保留视野
                return newInitial;
            }
            return currentState; // 无法复活
        },

        getWallBetween(pos1, pos2, walls) {
            if (pos2.x > pos1.x) return walls.v[pos1.y][pos1.x + 1];
            if (pos2.x < pos1.x) return walls.v[pos1.y][pos1.x];
            if (pos2.y > pos1.y) return walls.h[pos1.y + 1][pos1.x];
            if (pos2.y < pos1.y) return walls.h[pos1.y][pos1.x];
            return null;
        }
    };

    const game = new GhostMazeGame();
});