package fmj.combat

import fmj.combat.actions.*
import fmj.magic.MagicAuxiliary

import graphics.Canvas

import java.Queue

class ActionExecutor(
        /** 被执行的动作队列 */
        private val mActionQueue: Queue<Action>, private val mCombat: Combat) {

    /** 当前执行的动作 */
    private var mCurrentAction: Action? = null

    private var mIsNewAction = true

    private var postAction: PostAction? = null

    fun reset() {
        mCurrentAction = null
        mIsNewAction = true
    }

    /**
     *
     * @param delta
     * @return 执行完毕返回`false`，否则返回`true`
     */
    fun update(delta: Long): Boolean {
        postAction?.let {
            if (it.update(delta)) {
                return true
            }
            postAction = null
            // 所有敌人已死亡（最后一个被本回合更快的行动击杀）：不再弹出/
            // 执行队列中剩余的技能、招式、攻击、回血等，交由 Combat 进入
            // 胜利结算。当前正在执行的致胜一击及其后续动画已在到达此处前
            // 完成，保持自然。cancelRemainingActions 逐个 cancel() 退还
            // 投掷武器/使用道具（数量在选择行动时已扣减）；普通攻击/法术的
            // cancel() 为空操作，法术 MP 在执行时才扣除（此处永不执行）。
            if (mCombat.isAllMonsterDead) {
                cancelRemainingActions()
                return false
            }
            mCurrentAction = mActionQueue.pop() // 取下一个动作
            if (mCurrentAction == null) { // 所有动作执行完毕
                return false
            }
            mIsNewAction = true
            return true
        }

        if (mCurrentAction == null) {
            if (mCombat.isAllMonsterDead) {
                cancelRemainingActions()
                return false
            }
            mCurrentAction = mActionQueue.pop()
            if (mCurrentAction == null) {
                return false
            }
            mIsNewAction = true
        }

        if (mIsNewAction) {
            prepareAction()
            return true
        }

        if (!mCurrentAction!!.update(delta)) { // 当前动作执行完毕
            mCurrentAction!!.postExecute()
            postAction()
        }

        return true
    }

    private fun cancelRemainingActions() {
        while (true) {
            val a = mActionQueue.pop() ?: break
            a.cancel()
        }
    }

    private fun postAction() {
        postAction = mCurrentAction!!.postAction()
        mCurrentAction!!.decay()
        mCurrentAction = null
        mIsNewAction = false
    }

    /**
     * 执行完毕返回`false`
     */
    private fun prepareAction() {
        // attacker dead, goto next action
        if (!mCurrentAction!!.isAttackerActionable) {
            mCurrentAction!!.cancel()
            postAction()
            return
        }

        // 乱
        if (mCurrentAction!!.isAttackerConfusing) {
            mCurrentAction!!.cancel()
            mCurrentAction = ActionSelfHurt(mCurrentAction!!.mAttacker!!)
        }

        if (mCurrentAction!!.isMagic && mCurrentAction!!.isAttackerSealed) {
            mCurrentAction!!.cancel()
            mCurrentAction = mCurrentAction!!.rollbackToPhysical()
        }

        // target dead, get an alive target
        if (!mCurrentAction!!.isTargetAlive) {
            if (!mCurrentAction!!.isSingleTarget) { // 敌人都死了
                // 目标已全灭却无可转移：行动无法命中。投掷/使用道具的数量在
                // 选择时已 deleteGoods 扣减，直接丢弃不 cancel() 会吞道具。
                // 普通攻击/法术的 cancel() 为空操作，安全。
                mCurrentAction!!.cancel()
                mCurrentAction = null
            } else { // try to find an alive target
                // 检查是否为复活药物动作（只有类型10灵药具有复活功能）
                val isRevivalItemAction = mCurrentAction is ActionUseItemOne &&
                    (mCurrentAction as ActionUseItemOne).goods.let { goods ->
                        goods.type == 10    // 只有GoodsMedicineLife (灵药类) 具有复活功能
                    }

                // 检查是否为复活魔法动作（只有MagicAuxiliary辅助型魔法具有复活功能）
                val isRevivalMagicAction = mCurrentAction is ActionMagicHelpOne &&
                    (mCurrentAction as ActionMagicHelpOne).magic.let { magic ->
                        magic is MagicAuxiliary    // 只有MagicAuxiliary具有复活功能
                    }

                if (isRevivalItemAction || isRevivalMagicAction) {
                    // 复活道具或复活魔法允许对阵亡目标使用，不改变目标
                    println("ActionExecutor: 复活动作保持阵亡目标不变")
                    // Do nothing, keep the dead target
                } else {
                    // 非复活药物需要找存活目标
                    val newTarget =
                            if (mCurrentAction!!.targetIsMonster()) {
                                mCombat.firstAliveMonster
                            } else {
                                mCombat.randomAlivePlayer
                            }
                    if (newTarget == null) {
                        // 无可转移的存活目标：cancel() 退还已扣减的道具。
                        mCurrentAction!!.cancel()
                        postAction()
                        return
                    } else if (mCurrentAction is ActionCoopMagic) {
                        // 合击行动虽 isSingleTarget=true，但它不是
                        // ActionSingleTarget 的子类，走 setTarget 强转会抛
                        // ClassCastException。合击目标存放在 mMonsters[0]，
                        // 通过 mMonster setter 整体替换把目标转移到新存活
                        // 的怪物上。
                        (mCurrentAction as ActionCoopMagic).mMonster = newTarget
                    } else if (mCurrentAction !is ActionFlee) {
                        (mCurrentAction as ActionSingleTarget).setTarget(newTarget)
                    }
                }
            }
        }
        mCurrentAction?.preproccess()
        mIsNewAction = false
    }

    fun draw(canvas: Canvas) {
        postAction?.let {
            it.draw(canvas)
            return
        }
        mCurrentAction?.draw(canvas)
    }
}
