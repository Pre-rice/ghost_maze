/**
 * GameState: 存储游戏某一时刻的完整动态快照。
 * 这是一个纯粹的数据对象，代表游戏的一个瞬间。
 * 包含：玩家状态、循环次数、死亡/胜利标志、每层的动态状态、已探索区域
 */
export class GameState {
    constructor(data) {
        // 玩家状态
        this.player = {
            x: data.player.x,
            y: data.player.y,
            layer: data.player.layer,
            hp: data.player.hp,
            stamina: data.player.stamina,
            keys: data.player.keys,
            steps: data.player.steps,
            trail: JSON.parse(JSON.stringify(data.player.trail || []))
        };
        
        this.loopCount = data.loopCount || 0;
        this.isDead = data.isDead || false;
        this.isWon = data.isWon || false;
        this.deathReason = data.deathReason || '';
        this.isRevivalPoint = data.isRevivalPoint || false;

        // 每层的动态状态
        this.layerStates = data.layerStates.map(ls => ({
            ghosts: JSON.parse(JSON.stringify(ls.ghosts)),
            items: JSON.parse(JSON.stringify(ls.items)),
            // 墙体的当前状态（主要是字母门的开关状态和数字门的消耗状态）
            wallStates: {
                h: JSON.parse(JSON.stringify(ls.wallStates.h)),
                v: JSON.parse(JSON.stringify(ls.wallStates.v))
            }
        }));

        // 每层的已探索区域
        this.seenCells = JSON.parse(JSON.stringify(data.seenCells));
    }

    clone() {
        return new GameState(JSON.parse(JSON.stringify(this)));
    }
};
