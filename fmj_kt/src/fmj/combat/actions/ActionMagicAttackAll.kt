package fmj.combat.actions

import fmj.characters.FightingCharacter
import fmj.characters.Monster
import fmj.characters.Player
import fmj.combat.Combat
import fmj.lib.ResSrs
import fmj.magic.MagicAttack

import graphics.Canvas

class ActionMagicAttackAll(attacker: FightingCharacter,
                           targets: List<FightingCharacter>, internal val magic: MagicAttack
) : ActionMultiTarget(attacker, targets) {

    private var mState = 1

    private var mAni: ResSrs? = null
    
    // 动画显示位置
    private var mAnix: Int = 0
    private var mAniy: Int = 0

    private var ox: Int = 0
    private var oy: Int = 0

    override val isMagic = true

    override fun preproccess() {
        val attacker = mAttacker?:return
        println("ActionMagicAttackAll: 准备执行群体攻击，施术者: ${attacker.name}, 目标数量: ${mTargets.size}")
        attacker.backupStatus()
        mTargets.forEach { 
            println("  目标: ${it.name} at (${it.combatX}, ${it.combatY}), isPlayer=${it is Player}")
            it.backupStatus() 
        }

        ox = attacker.combatX
        oy = attacker.combatY
        mAni = magic.magicAni
        mAni!!.start()
        mAni!!.setIteratorNum(2)

        // 全体攻击特效锚定在目标阵营的几何中心（上/中/下三槽位中点），
        // 与当前存活数量无关——否则只剩 1 个站在上/下槽位的目标时，特效
        // 会跟着它偏离中心。阵营按首个目标类型选取槽位表：玩家目标用
        // Combat.sPlayerPos，怪物目标用 Monster.arr。
        var sumW = 0
        var sumH = 0
        var sampled = 0
        mTargets.forEach {
            val fs = it.fightingSprite
            if (fs != null) {
                sumW += fs.width
                sumH += fs.height
                sampled++
            }
        }
        if (sampled > 0 && mTargets.isNotEmpty()) {
            val slots: dynamic = if (mTargets[0] is Player) Combat.sPlayerPos else Monster.arr
            val width = sumW / sampled
            val height = sumH / sampled
            val center = js("typeof window.BBKSrsAnchor !== 'undefined'" +
                    " ? window.BBKSrsAnchor.formationCenter(slots, width, height) : null")
            if (center != null) {
                mAnix = center.x
                mAniy = center.y
            } else {
                val firstTarget = mTargets[0]
                mAnix = firstTarget.combatX
                mAniy = firstTarget.combatY - (firstTarget.fightingSprite?.height ?: 16) / 2
            }
            println("ActionMagicAttackAll: 动画位置计算完成（目标阵营中心） -> ($mAnix, $mAniy)")
        }

        // 过滤出活着的敌人，但不修改原始mTargets列表。
        // 过滤发生在施法之前，因此被本法术击杀的目标仍在 aliveTargets 中、
        // 会飘出真实伤害数字（diffToAnimation 用未钳制增量）；本就死亡的
        // 尸体被排除，不飘字。
        val aliveTargets = mTargets.filter { it.isAlive }

        magic.use(attacker, aliveTargets)

        mRaiseAnimations.add(attacker.diffToAnimation())
        // 只为活着的敌人生成动画
        mRaiseAnimations.addAll(aliveTargets.map { it.diffToAnimation() })
    }

    override fun update(delta: Long): Boolean {
        super.update(delta)
        when (mState) {
            STATE_PRE -> if (mCurrentFrame < 10) {
                if (mAttacker is Player) {
                    mAttacker!!.fightingSprite!!.currentFrame = mCurrentFrame * 3 / 10 + 6
                } else {
                    mAttacker!!.setCombatPos(ox + 2, oy + 2)
                }
            } else {
                mState = STATE_ANI
            }

            STATE_ANI -> if (!mAni!!.update(delta)) {
                mState = STATE_AFT
                if (mAttacker is Player) {
                    (mAttacker as Player).setFrameByState()
                } else {
                    mAttacker!!.fightingSprite!!.move(-2, -2)
                }
                if (mTargets[0] is Player) {
                    for (fc in mTargets) {
                        fc.fightingSprite!!.currentFrame = 10
                    }
                } else {
                    for (fc in mTargets) {
                        fc.fightingSprite!!.move(2, 2)
                    }
                }
            }

            STATE_AFT -> if (!updateRaiseAnimation(delta)) {
                if (mTargets[0] is Player) {
                    for (fc in mTargets) {
                        (fc as Player).setFrameByState()
                    }
                } else {
                    for (fc in mTargets) {
                        fc.fightingSprite!!.move(-2, -2)
                    }
                }
                return false
            }
        }
        return true
    }

    override fun draw(canvas: Canvas) {
        super.draw(canvas)
        if (mState == STATE_ANI) {
            println("ActionMagicAttackAll: 绘制动画 at ($mAnix, $mAniy)")
            // 多目标攻击 SRS 的原始编队坐标是按玩家队伍制作的，以特效
            // 视觉锚点为基准对准目标阵营中心绘制。
            mAni!!.drawAtTarget(canvas, mAnix, mAniy)
        } else if (mState == STATE_AFT) {
            drawRaiseAnimation(canvas)
        }
    }

    override fun rollbackToPhysical(): Action {
        val attacker = mAttacker!!
        return if (attacker.hasAtbuff(FightingCharacter.BUFF_MASK_ALL))
            ActionPhysicalAttackAll(attacker, mTargets)
        else
            ActionPhysicalAttackOne(attacker, mTargets[0])
    }

    companion object {

        private val STATE_PRE = 1 // 起手动画
        private val STATE_ANI = 2 // 魔法动画
        private val STATE_AFT = 3 // 伤害动画
    }

}
