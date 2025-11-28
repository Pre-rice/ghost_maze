import { WALL_TYPES } from './constants.js';
import { GameState } from './gameState.js';

// ==================================================
//  GameLogic: 纯函数模块，处理所有游戏逻辑
// ==================================================

export const GameLogic = {
    /**
     * 从 MapDefinition 创建游戏初始状态
     */
    createInitialState(mapDef) {
        // 创建每层的动态状态
        const layerStates = mapDef.layers.map((layerDef, layerIndex) => {
            // 复制初始墙体状态
            const hWallStates = layerDef.initialWalls.h.map(row => 
                row.map(wall => ({
                    type: wall.type,
                    keys: wall.keys || 0,
                    direction: wall.direction ? { ...wall.direction } : null,
                    letter: wall.letter || null,
                    initialState: wall.initialState || 'closed',
                    currentState: wall.initialState || 'closed'
                }))
            );
            const vWallStates = layerDef.initialWalls.v.map(row => 
                row.map(wall => ({
                    type: wall.type,
                    keys: wall.keys || 0,
                    direction: wall.direction ? { ...wall.direction } : null,
                    letter: wall.letter || null,
                    initialState: wall.initialState || 'closed',
                    currentState: wall.initialState || 'closed'
                }))
            );

            return {
                ghosts: layerDef.initialEntities.ghosts.map((g, idx) => ({
                    x: g.x,
                    y: g.y,
                    id: g.id !== undefined ? g.id : idx,
                    trail: []
                })),
                items: layerDef.initialEntities.items.map(i => ({
                    x: i.x,
                    y: i.y,
                    type: i.type || 'key'
                })),
                wallStates: { h: hWallStates, v: vWallStates }
            };
        });

        // 创建每层的视野
        const seenCells = [];
        for (let i = 0; i < mapDef.layerCount; i++) {
            seenCells.push(
                Array(mapDef.height).fill(null).map(() => Array(mapDef.width).fill(false))
            );
        }

        const initialState = new GameState({
            player: {
                x: mapDef.playerStart.x,
                y: mapDef.playerStart.y,
                layer: mapDef.playerStart.layer,
                hp: mapDef.initialHealth,
                stamina: mapDef.initialStamina,
                keys: 0,
                steps: 0,
                trail: []
            },
            loopCount: 0,
            layerStates: layerStates,
            seenCells: seenCells,
            isRevivalPoint: true
        });

        // 更新初始视野
        return this.updateVisibility(initialState, mapDef);
    },

    /**
     * 根据动作计算下一个状态
     * @returns {GameState} 新状态，如果无变化则返回原状态
     */
    calculateNextState(currentState, action, mapDef) {
        if (currentState.isDead || currentState.isWon) {
            // 特殊情况：复活动作
            if (action.type === 'REVIVE') {
                return this.handleRevive(currentState, mapDef);
            }
            return currentState;
        }

        const nextState = currentState.clone();
        const originalPlayerPos = { 
            x: currentState.player.x, 
            y: currentState.player.y, 
            layer: currentState.player.layer 
        };

        let stateChanged = false;
        let isStairAction = false;

        switch (action.type) {
            case 'MOVE':
                stateChanged = this.handleMove(nextState, action.payload, mapDef);
                break;
            case 'USE_STAIR':
                stateChanged = this.handleUseStair(nextState, mapDef);
                isStairAction = true;
                break;
            case 'PRESS_BUTTON':
                stateChanged = this.handlePressButton(nextState, action.payload, mapDef);
                break;
            case 'REVIVE':
                return this.handleRevive(currentState, mapDef);
            default:
                return currentState;
        }

        if (!stateChanged) {
            return currentState;
        }

        // 按顺序处理玩家操作后的所有变化
        this.handleItemPickup(nextState, mapDef);
        
        if (isStairAction) {
            // 玩家使用楼梯：让原层的鬼向玩家原位置移动
            this.moveGhostsAfterStair(nextState, originalPlayerPos, mapDef);
        } else {
            // 普通移动：处理鬼的移动（包括跨楼梯追踪）
            this.moveGhostsWithStairChase(nextState, originalPlayerPos, mapDef);
        }
        
        this.checkCollisions(nextState, mapDef);
        this.updateVisibility(nextState, mapDef);
        this.checkWinLossConditions(nextState, mapDef);

        nextState.isRevivalPoint = false;
        return nextState;
    },

    /**
     * 处理移动动作
     */
    handleMove(state, direction, mapDef) {
        const p = state.player;
        const playerLayer = p.layer;
        const layerDef = mapDef.layers[playerLayer];
        const layerState = state.layerStates[playerLayer];
        
        // 检查是否按下了按钮
        const buttons = layerDef.initialEntities.buttons || [];
        const button = buttons.find(b => 
            b.x === p.x && 
            b.y === p.y && 
            b.direction.dx === direction.dx && 
            b.direction.dy === direction.dy
        );
        if (button) {
            return this.handlePressButton(state, { letter: button.letter }, mapDef);
        }

        const newX = p.x + direction.dx;
        const newY = p.y + direction.dy;

        // 边界检查
        if (newX < 0 || newX >= mapDef.width || newY < 0 || newY >= mapDef.height) {
            return false;
        }

        // 检查目标格子是否是有效地图方格
        if (!layerDef.activeCells[newY][newX]) {
            return false;
        }

        // 获取墙体
        const wallDef = this._getWallBetween(p, { x: newX, y: newY }, layerDef.initialWalls, direction);
        const wallState = this._getWallStateBetween(p, { x: newX, y: newY }, layerState.wallStates, direction);

        if (wallDef && wallDef.type !== WALL_TYPES.EMPTY) {
            // 实心墙或玻璃墙不可通过
            if (wallDef.type === WALL_TYPES.SOLID || wallDef.type === WALL_TYPES.GLASS) {
                return false;
            }
            // 单向门检查方向
            if (wallDef.type === WALL_TYPES.ONE_WAY) {
                if (!wallDef.direction || direction.dx !== wallDef.direction.dx || direction.dy !== wallDef.direction.dy) {
                    return false;
                }
            }
            // 数字门检查钥匙数量
            if (wallDef.type === WALL_TYPES.LOCKED) {
                if (p.keys < (wallDef.keys || 0)) {
                    return false;
                }
                // 消耗门：将墙体类型设为空
                if (wallState) {
                    wallState.type = WALL_TYPES.EMPTY;
                }
            }
            // 字母门检查开关状态
            if (wallDef.type === WALL_TYPES.LETTER_DOOR) {
                if (wallState && wallState.currentState === 'closed') {
                    return false;
                }
            }
        }

        // 添加轨迹
        p.trail.unshift({ x: p.x, y: p.y, timestamp: Date.now() });
        if (p.trail.length > 10) p.trail.pop();

        // 更新玩家位置
        p.x = newX;
        p.y = newY;
        p.steps++;

        // 死亡循环模式消耗体力
        if (mapDef.gameMode === 'death-loop') {
            p.stamina--;
        }

        return true;
    },

    /**
     * 处理使用楼梯
     */
    handleUseStair(state, mapDef) {
        if (!mapDef.multiLayerMode) return false;

        const p = state.player;
        const stairs = mapDef.stairs;
        
        // 查找玩家位置的楼梯
        const stair = stairs.find(s => 
            s.x === p.x && 
            s.y === p.y && 
            s.layer === p.layer
        );

        if (!stair) return false;

        // 计算目标层
        const targetLayer = stair.direction === 'up' ? p.layer + 1 : p.layer - 1;
        if (targetLayer < 0 || targetLayer >= mapDef.layerCount) return false;

        // 检查目标层是否有对应楼梯
        const targetStair = stairs.find(s =>
            s.x === p.x &&
            s.y === p.y &&
            s.layer === targetLayer &&
            s.direction === (stair.direction === 'up' ? 'down' : 'up')
        );

        if (!targetStair) return false;

        // 执行上下楼
        p.layer = targetLayer;
        p.steps++;

        if (mapDef.gameMode === 'death-loop') {
            p.stamina--;
        }

        return true;
    },

    /**
     * 处理按下按钮
     */
    handlePressButton(state, payload, mapDef) {
        const letter = payload.letter;
        let toggled = false;

        // 遍历所有图层的墙体状态，切换对应字母门
        state.layerStates.forEach(layerState => {
            const toggleWall = (wall) => {
                if (wall.type === WALL_TYPES.LETTER_DOOR && wall.letter === letter) {
                    wall.currentState = wall.currentState === 'closed' ? 'open' : 'closed';
                    toggled = true;
                }
            };

            layerState.wallStates.h.forEach(row => row.forEach(toggleWall));
            layerState.wallStates.v.forEach(row => row.forEach(toggleWall));
        });

        return toggled;
    },

    /**
     * 处理物品拾取
     */
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

    /**
     * 移动所有鬼
     */
    moveGhosts(state, originalPlayerPos, mapDef) {
        const playerLayer = state.player.layer;
        const ghosts = state.layerStates[playerLayer].ghosts;
        const layerDef = mapDef.layers[playerLayer];
        const layerState = state.layerStates[playerLayer];

        let moveIntents = [];

        // 收集移动意图
        for (const ghost of ghosts) {
            const sawBefore = this._canGhostSeePlayer(ghost, originalPlayerPos, layerDef, layerState);
            const seesAfter = this._canGhostSeePlayer(ghost, state.player, layerDef, layerState);

            let target = null;
            if (!sawBefore && seesAfter) target = state.player;
            else if (sawBefore && !seesAfter) target = originalPlayerPos;
            else if (sawBefore && seesAfter) target = state.player;

            if (target) {
                const path = this._findShortestPath(ghost, target, layerDef, layerState);
                if (path && path.length > 1) {
                    moveIntents.push({ ghost, nextStep: path[1] });
                }
            }
        }

        if (moveIntents.length === 0) return;

        // 解决移动冲突
        let maxIterations = ghosts.length + 1;
        let madeProgress = true;

        while (madeProgress && moveIntents.length > 0 && maxIterations > 0) {
            madeProgress = false;
            maxIterations--;

            const occupiedCells = new Set(ghosts.map(g => `${g.x},${g.y}`));
            let possibleMoves = [];
            let remainingIntents = [];

            for (const intent of moveIntents) {
                const targetKey = `${intent.nextStep.x},${intent.nextStep.y}`;
                if (!occupiedCells.has(targetKey)) {
                    possibleMoves.push(intent);
                } else {
                    remainingIntents.push(intent);
                }
            }

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

            if (finalMovesThisPass.length > 0) {
                for (const { ghost, nextStep } of finalMovesThisPass) {
                    ghost.trail.unshift({ x: ghost.x, y: ghost.y, timestamp: Date.now() });
                    if (ghost.trail.length > 5) ghost.trail.pop();
                    ghost.x = nextStep.x;
                    ghost.y = nextStep.y;
                }
                madeProgress = true;
            }

            moveIntents = remainingIntents;
        }
    },

    /**
     * 玩家使用楼梯后的鬼移动：让原层正在追击的鬼向玩家原位置移动一步
     */
    moveGhostsAfterStair(state, originalPlayerPos, mapDef) {
        const originalLayer = originalPlayerPos.layer;
        const ghosts = state.layerStates[originalLayer].ghosts;
        const layerDef = mapDef.layers[originalLayer];
        const layerState = state.layerStates[originalLayer];

        let moveIntents = [];

        // 收集移动意图：只有之前能看到玩家的鬼才会移动
        for (const ghost of ghosts) {
            const sawBefore = this._canGhostSeePlayer(ghost, originalPlayerPos, layerDef, layerState);

            if (sawBefore) {
                // 向玩家原位置移动
                const path = this._findShortestPath(ghost, originalPlayerPos, layerDef, layerState);
                if (path && path.length > 1) {
                    moveIntents.push({ ghost, nextStep: path[1] });
                }
            }
        }

        if (moveIntents.length === 0) return;

        // 解决移动冲突（与 moveGhosts 相同的逻辑）
        let maxIterations = ghosts.length + 1;
        let madeProgress = true;

        while (madeProgress && moveIntents.length > 0 && maxIterations > 0) {
            madeProgress = false;
            maxIterations--;

            const occupiedCells = new Set(ghosts.map(g => `${g.x},${g.y}`));
            let possibleMoves = [];
            let remainingIntents = [];

            for (const intent of moveIntents) {
                const targetKey = `${intent.nextStep.x},${intent.nextStep.y}`;
                if (!occupiedCells.has(targetKey)) {
                    possibleMoves.push(intent);
                } else {
                    remainingIntents.push(intent);
                }
            }

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

            if (finalMovesThisPass.length > 0) {
                for (const { ghost, nextStep } of finalMovesThisPass) {
                    ghost.trail.unshift({ x: ghost.x, y: ghost.y, timestamp: Date.now() });
                    if (ghost.trail.length > 5) ghost.trail.pop();
                    ghost.x = nextStep.x;
                    ghost.y = nextStep.y;
                }
                madeProgress = true;
            }

            moveIntents = remainingIntents;
        }
    },

    /**
     * 普通移动时的鬼移动：包括跨楼梯追踪
     * 当玩家和鬼分别处于一对楼梯的两端时，鬼可以看见玩家
     * 玩家移动后（非上下楼梯），鬼会通过楼梯来到玩家移动前的位置
     */
    moveGhostsWithStairChase(state, originalPlayerPos, mapDef) {
        const playerLayer = state.player.layer;
        
        // 首先处理可能通过楼梯追踪的鬼，获取已经通过楼梯移动的鬼列表
        let ghostsMovedViaStair = new Set();
        if (mapDef.multiLayerMode) {
            ghostsMovedViaStair = this._handleGhostStairChase(state, originalPlayerPos, mapDef);
        }
        
        // 然后处理当前层的正常鬼移动（排除已经通过楼梯移动的鬼）
        const ghosts = state.layerStates[playerLayer].ghosts;
        const layerDef = mapDef.layers[playerLayer];
        const layerState = state.layerStates[playerLayer];

        let moveIntents = [];

        // 收集移动意图（排除已通过楼梯移动的鬼）
        for (const ghost of ghosts) {
            // 跳过已经通过楼梯移动的鬼
            if (ghostsMovedViaStair.has(ghost)) {
                continue;
            }
            
            const sawBefore = this._canGhostSeePlayer(ghost, originalPlayerPos, layerDef, layerState);
            const seesAfter = this._canGhostSeePlayer(ghost, state.player, layerDef, layerState);

            let target = null;
            if (!sawBefore && seesAfter) target = state.player;
            else if (sawBefore && !seesAfter) target = originalPlayerPos;
            else if (sawBefore && seesAfter) target = state.player;

            if (target) {
                const path = this._findShortestPath(ghost, target, layerDef, layerState);
                if (path && path.length > 1) {
                    moveIntents.push({ ghost, nextStep: path[1] });
                }
            }
        }

        if (moveIntents.length === 0) return;

        // 解决移动冲突
        let maxIterations = ghosts.length + 1;
        let madeProgress = true;

        while (madeProgress && moveIntents.length > 0 && maxIterations > 0) {
            madeProgress = false;
            maxIterations--;

            const occupiedCells = new Set(ghosts.map(g => `${g.x},${g.y}`));
            let possibleMoves = [];
            let remainingIntents = [];

            for (const intent of moveIntents) {
                const targetKey = `${intent.nextStep.x},${intent.nextStep.y}`;
                if (!occupiedCells.has(targetKey)) {
                    possibleMoves.push(intent);
                } else {
                    remainingIntents.push(intent);
                }
            }

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

            if (finalMovesThisPass.length > 0) {
                for (const { ghost, nextStep } of finalMovesThisPass) {
                    ghost.trail.unshift({ x: ghost.x, y: ghost.y, timestamp: Date.now() });
                    if (ghost.trail.length > 5) ghost.trail.pop();
                    ghost.x = nextStep.x;
                    ghost.y = nextStep.y;
                }
                madeProgress = true;
            }

            moveIntents = remainingIntents;
        }
    },

    /**
     * 处理鬼通过楼梯追踪玩家
     * 当玩家和鬼处于配对楼梯的两端时，鬼会穿过楼梯追击
     * @returns {Set} 已经通过楼梯移动的鬼的集合
     */
    _handleGhostStairChase(state, originalPlayerPos, mapDef) {
        const movedGhosts = new Set();
        const playerLayer = state.player.layer;
        const stairs = mapDef.stairs;
        
        // 查找玩家原位置是否在楼梯上
        const playerStair = stairs.find(s => 
            s.x === originalPlayerPos.x && 
            s.y === originalPlayerPos.y && 
            s.layer === originalPlayerPos.layer
        );
        
        if (!playerStair) return movedGhosts;
        
        // 找到配对的楼梯（另一层）
        const pairedLayer = playerStair.direction === 'up' ? originalPlayerPos.layer + 1 : originalPlayerPos.layer - 1;
        if (pairedLayer < 0 || pairedLayer >= mapDef.layerCount) return movedGhosts;
        
        const pairedStair = stairs.find(s =>
            s.x === originalPlayerPos.x &&
            s.y === originalPlayerPos.y &&
            s.layer === pairedLayer &&
            s.direction === (playerStair.direction === 'up' ? 'down' : 'up')
        );
        
        if (!pairedStair) return movedGhosts;
        
        // 检查配对层是否有鬼在楼梯位置上
        const pairedLayerGhosts = state.layerStates[pairedLayer].ghosts;
        const ghostsOnPairedStair = pairedLayerGhosts.filter(g => 
            g.x === pairedStair.x && g.y === pairedStair.y
        );
        
        // 这些鬼可以"看见"玩家，会穿过楼梯追击
        for (const ghost of ghostsOnPairedStair) {
            // 从配对层移除鬼
            const ghostIndex = pairedLayerGhosts.indexOf(ghost);
            if (ghostIndex > -1) {
                pairedLayerGhosts.splice(ghostIndex, 1);
            }
            
            // 将鬼添加到玩家原来的层，位置为玩家原位置
            ghost.x = originalPlayerPos.x;
            ghost.y = originalPlayerPos.y;
            ghost.trail = [];
            state.layerStates[originalPlayerPos.layer].ghosts.push(ghost);
            
            // 标记这个鬼已经移动过了
            movedGhosts.add(ghost);
        }
        
        return movedGhosts;
    },

    /**
     * 检查碰撞
     */
    checkCollisions(state, mapDef) {
        const p = state.player;
        const ghosts = state.layerStates[p.layer].ghosts;
        
        if (ghosts.some(g => g.x === p.x && g.y === p.y)) {
            state.isDead = true;
            state.deathReason = 'ghost';
            
            if (mapDef.gameMode === 'exploration') {
                p.hp--;
            }
        }
    },

    /**
     * 更新视野
     */
    updateVisibility(state, mapDef) {
        const p = state.player;
        const layer = p.layer;
        const seen = state.seenCells[layer];
        const layerDef = mapDef.layers[layer];
        const layerState = state.layerStates[layer];

        // 常规模式：揭示出生房间
        if (mapDef.editorMode === 'regular') {
            const roomY = mapDef.height - 3;
            for (let y = roomY; y < roomY + 3; y++) {
                for (let x = 0; x < 3; x++) {
                    if (y >= 0 && y < mapDef.height && x >= 0 && x < mapDef.width) {
                        seen[y][x] = true;
                    }
                }
            }
        } else {
            // 自由模式：揭示起点
            const start = layerDef.initialEntities.customStartPos;
            if (start && seen[start.y] && start.x >= 0 && start.x < mapDef.width) {
                seen[start.y][start.x] = true;
            }
        }

        // 玩家当前位置可见
        seen[p.y][p.x] = true;

        // 四方向射线投射
        const castRay = (dx, dy) => {
            let x = p.x + dx;
            let y = p.y + dy;
            
            while (x >= 0 && x < mapDef.width && y >= 0 && y < mapDef.height) {
                // 检查是否是有效格子
                if (!layerDef.activeCells[y][x]) break;

                // 检查墙体
                let wall;
                if (dx === 1) wall = layerState.wallStates.v[p.y][x];
                else if (dx === -1) wall = layerState.wallStates.v[p.y][x + 1];
                else if (dy === 1) wall = layerState.wallStates.h[y][p.x];
                else if (dy === -1) wall = layerState.wallStates.h[y + 1][p.x];

                if (wall && wall.type !== WALL_TYPES.EMPTY && wall.type !== WALL_TYPES.GLASS) {
                    break;
                }

                seen[y][x] = true;
                x += dx;
                y += dy;
            }
        };

        castRay(1, 0);
        castRay(-1, 0);
        castRay(0, 1);
        castRay(0, -1);

        // 多层模式：楼梯视野穿透
        if (mapDef.multiLayerMode) {
            const playerStair = mapDef.stairs.find(s => 
                s.x === p.x && s.y === p.y && s.layer === p.layer
            );
            if (playerStair) {
                const targetLayer = playerStair.direction === 'up' ? p.layer + 1 : p.layer - 1;
                if (targetLayer >= 0 && targetLayer < mapDef.layerCount && state.seenCells[targetLayer]) {
                    state.seenCells[targetLayer][p.y][p.x] = true;
                }
            }
        }

        return state;
    },

    /**
     * 检查胜利/失败条件
     */
    checkWinLossConditions(state, mapDef) {
        const p = state.player;
        const layerDef = mapDef.layers[p.layer];
        const endPos = layerDef.initialEntities.endPos;

        // 检查胜利
        if (endPos && p.x === endPos.x && p.y === endPos.y) {
            state.isWon = true;
        }

        // 检查失败
        if (mapDef.gameMode === 'exploration' && p.hp <= 0) {
            state.isDead = true;
            state.deathReason = 'no_hp';
        }
        if (mapDef.gameMode === 'death-loop' && p.stamina <= 0) {
            state.isDead = true;
            state.deathReason = 'no_stamina';
        }
    },

    /**
     * 处理复活
     */
    handleRevive(currentState, mapDef) {
        if (mapDef.gameMode === 'exploration') {
            if (currentState.player.hp > 0) {
                const nextState = currentState.clone();
                nextState.isDead = false;
                nextState.deathReason = '';
                
                // 回到出生点
                nextState.player.x = mapDef.playerStart.x;
                nextState.player.y = mapDef.playerStart.y;
                nextState.player.layer = mapDef.playerStart.layer;
                nextState.player.trail = [];
                nextState.isRevivalPoint = true;
                
                return this.updateVisibility(nextState, mapDef);
            }
        } else {
            // 死亡循环模式：重置但保留视野
            const nextState = this.createInitialState(mapDef);
            nextState.loopCount = currentState.loopCount + 1;
            nextState.seenCells = JSON.parse(JSON.stringify(currentState.seenCells));
            nextState.isRevivalPoint = true;
            return nextState;
        }
        
        return currentState;
    },

    // === 辅助函数 ===

    _getWallBetween(pos1, pos2, walls, direction) {
        if (direction.dx === 1) return walls.v[pos1.y] ? walls.v[pos1.y][pos1.x + 1] : null;
        if (direction.dx === -1) return walls.v[pos1.y] ? walls.v[pos1.y][pos1.x] : null;
        if (direction.dy === 1) return walls.h[pos1.y + 1] ? walls.h[pos1.y + 1][pos1.x] : null;
        if (direction.dy === -1) return walls.h[pos1.y] ? walls.h[pos1.y][pos1.x] : null;
        return null;
    },

    _getWallStateBetween(pos1, pos2, wallStates, direction) {
        if (direction.dx === 1) return wallStates.v[pos1.y] ? wallStates.v[pos1.y][pos1.x + 1] : null;
        if (direction.dx === -1) return wallStates.v[pos1.y] ? wallStates.v[pos1.y][pos1.x] : null;
        if (direction.dy === 1) return wallStates.h[pos1.y + 1] ? wallStates.h[pos1.y + 1][pos1.x] : null;
        if (direction.dy === -1) return wallStates.h[pos1.y] ? wallStates.h[pos1.y][pos1.x] : null;
        return null;
    },

    _canGhostSeePlayer(ghost, playerPos, layerDef, layerState) {
        if (!playerPos || (ghost.x !== playerPos.x && ghost.y !== playerPos.y)) return false;

        const wallStates = layerState.wallStates;

        if (ghost.x === playerPos.x) {
            const startY = Math.min(ghost.y, playerPos.y);
            const endY = Math.max(ghost.y, playerPos.y);
            for (let y = startY; y < endY; y++) {
                const wall = wallStates.h[y + 1][ghost.x];
                if (wall && wall.type !== WALL_TYPES.EMPTY && wall.type !== WALL_TYPES.GLASS) {
                    if (!(wall.type === WALL_TYPES.LETTER_DOOR && wall.currentState === 'open')) {
                        return false;
                    }
                }
            }
        } else {
            const startX = Math.min(ghost.x, playerPos.x);
            const endX = Math.max(ghost.x, playerPos.x);
            for (let x = startX; x < endX; x++) {
                const wall = wallStates.v[ghost.y][x + 1];
                if (wall && wall.type !== WALL_TYPES.EMPTY && wall.type !== WALL_TYPES.GLASS) {
                    if (!(wall.type === WALL_TYPES.LETTER_DOOR && wall.currentState === 'open')) {
                        return false;
                    }
                }
            }
        }
        return true;
    },

    _findShortestPath(start, end, layerDef, layerState) {
        const queue = [[{ x: start.x, y: start.y }]];
        const visited = new Set([`${start.x},${start.y}`]);
        const width = layerDef.activeCells[0].length;
        const height = layerDef.activeCells.length;

        while (queue.length > 0) {
            const path = queue.shift();
            const { x, y } = path[path.length - 1];

            if (x === end.x && y === end.y) return path;

            const neighbors = [{ dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }];
            for (const { dx, dy } of neighbors) {
                const nx = x + dx;
                const ny = y + dy;
                const key = `${nx},${ny}`;

                if (nx >= 0 && nx < width && ny >= 0 && ny < height && !visited.has(key)) {
                    if (!layerDef.activeCells[ny][nx]) continue;

                    let wall = null;
                    if (dx === 1) wall = layerState.wallStates.v[y][x + 1];
                    else if (dx === -1) wall = layerState.wallStates.v[y][x];
                    else if (dy === 1) wall = layerState.wallStates.h[y + 1][x];
                    else if (dy === -1) wall = layerState.wallStates.h[y][x];

                    if (wall && wall.type !== WALL_TYPES.EMPTY) {
                        if (wall.type === WALL_TYPES.LETTER_DOOR && wall.currentState === 'open') {
                            // 可以通过
                        } else {
                            continue;
                        }
                    }

                    visited.add(key);
                    queue.push([...path, { x: nx, y: ny }]);
                }
            }
        }
        return null;
    }
};
