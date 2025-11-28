/**
 * HistoryManager 模块 - 管理游戏历史记录和回溯功能
 */

import * as UI from './ui.js';

/**
 * 创建初始历史状态
 * @returns {object}
 */
export function createInitialHistory() {
    return {
        history: [],
        checkpoints: [],
        currentStep: -1
    };
}

/**
 * 记录新状态
 * @param {object} historyState - 历史状态
 * @param {object} newGameState - 新游戏状态
 * @returns {object} 更新后的历史状态
 */
export function recordState(historyState, newGameState) {
    let { history, checkpoints, currentStep } = historyState;
    
    // 如果在历史中间，删除后面的状态
    if (currentStep < history.length - 1) {
        history = history.slice(0, currentStep + 1);
        checkpoints = checkpoints.filter(cp => cp <= currentStep);
    }
    
    history.push(newGameState);
    currentStep++;
    
    return { history, checkpoints, currentStep };
}

/**
 * 撤回到上一步
 * @param {object} historyState - 历史状态
 * @returns {object|null} {newHistoryState, gameState} 或 null
 */
export function undo(historyState) {
    const { history, checkpoints, currentStep } = historyState;
    
    if (currentStep <= 0) return null;
    
    // 不能撤回到复活点之前
    if (history[currentStep] && history[currentStep].isRevivalPoint && currentStep > 0) {
        return { error: '无法撤回到复活点之前' };
    }
    
    const newStep = currentStep - 1;
    return {
        newHistoryState: { history, checkpoints, currentStep: newStep },
        gameState: history[newStep]
    };
}

/**
 * 保存存档点
 * @param {object} historyState - 历史状态
 * @returns {object} 更新后的历史状态
 */
export function save(historyState) {
    const { history, checkpoints, currentStep } = historyState;
    
    const lastCheckpoint = checkpoints.length > 0 ? checkpoints[checkpoints.length - 1] : -1;
    if (currentStep <= lastCheckpoint) {
        return { error: '请先移动后再存档' };
    }
    
    const newCheckpoints = [...checkpoints, currentStep];
    return {
        newHistoryState: { history, checkpoints: newCheckpoints, currentStep },
        message: `已在第 ${currentStep} 步创建存档`
    };
}

/**
 * 回溯到上一个存档点
 * @param {object} historyState - 历史状态
 * @returns {object|null}
 */
export function rewind(historyState) {
    const { history, checkpoints, currentStep } = historyState;
    
    const availableCheckpoints = checkpoints.filter(cp => cp < currentStep);
    if (availableCheckpoints.length === 0) {
        return { error: '没有更早的存档点可供回溯' };
    }
    
    const targetStep = Math.max(...availableCheckpoints);
    return {
        newHistoryState: { history, checkpoints, currentStep: targetStep },
        gameState: history[targetStep],
        message: `已回溯至存档点 (第 ${targetStep} 步)`
    };
}

/**
 * 更新历史按钮状态
 * @param {object} historyState - 历史状态
 */
export function updateHistoryButtons(historyState) {
    UI.updateHistoryButtons({
        currentStep: historyState.currentStep,
        history: historyState.history,
        checkpoints: historyState.checkpoints
    });
}
