package fmj.combat.actions

import fmj.characters.FightingCharacter
import fmj.characters.Monster
import fmj.characters.Player
import fmj.combat.Combat
import fmj.combat.anim.RaiseAnimation
import fmj.lib.ResSrs
import fmj.magic.BaseMagic

import graphics.Canvas

class ActionMagicHelpAll(attacker: FightingCharacter,
                         targets: List<FightingCharacter>, internal var magic: BaseMagic) : ActionMultiTarget(attacker, targets) {

    private var state = 1

    private lateinit var animation: ResSrs

    // 动画显示位置
    internal var mAnix: Int = 0
    internal var mAniy: Int = 0

    /** 特效按实际人数相对满员编队的压缩比例 */
    internal var animationScaleX: Double = 1.0
    internal var animationScaleY: Double = 1.0

    internal var ox: Int = 0
    internal var oy: Int = 0

    override val isMagic = true

    override fun preproccess() {
        val attacker = mAttacker?:return
        println("ActionMagicHelpAll: 准备执行群体魔法，施术者: ${attacker.name}, 目标数量: ${mTargets.size}")
        var targetX = 0
        var targetY = 0
        var targetCount = 0
        mTargets.forEach {
            println("  目标: ${it.name} at (${it.combatX}, ${it.combatY}), isPlayer=${it is Player}")
            it.backupStatus()
            targetX += it.combatX
            targetY += it.combatY
            targetCount++
        }

        ox = attacker.combatX
        oy = attacker.combatY
        animation = magic.magicAni!!
        animation.start()
        animation.setIteratorNum(2)

        // 特效对准目标编队的质心
        if (targetCount > 0) {
            mAnix = targetX / targetCount
            mAniy = targetY / targetCount
        }

        // SRS 精灵的各列特效是按满员 3 槽编队坐标制作的：人数不足时占用
        // 跨度小于全编队跨度，外列特效会落进空槽位。按占用跨度/满员跨度
        // 的比例只压缩横向偏移，使每列落在实际角色身上；Y 轴是动画轨迹，
        // 保持原样以避免把连续帧叠成同心圆。
        animationScaleX = 1.0
        animationScaleY = 1.0
        if (targetCount > 1 && mTargets.isNotEmpty()) {
            // sPlayerPos 是 Point 对（.x/.y），Monster.arr 是 intArrayOf 对
            //（[0]/[1]），归一化成坐标数组再算跨度。
            val slotXs: IntArray
            if (mTargets[0] is Player) {
                slotXs = IntArray(Combat.sPlayerPos.size) { Combat.sPlayerPos[it].x }
            } else {
                slotXs = IntArray(Monster.arr.size) { Monster.arr[it][0] }
            }
            val slotTotal = slotXs.size
            if (targetCount < slotTotal) {
                val fx0 = slotXs[0].toDouble()
                val fxN = slotXs[targetCount - 1].toDouble()
                val fxE = slotXs[slotTotal - 1].toDouble()
                if (fxE != fx0) {
                    animationScaleX = kotlin.math.abs(fxN - fx0) / kotlin.math.abs(fxE - fx0)
                }
            }
        }
        println("ActionMagicHelpAll: 动画位置计算完成（目标编队质心） -> ($mAnix, $mAniy), scale=($animationScaleX, $animationScaleY)")

        // 修复：群体恢复魔法只消耗一次MP
        val currentMagic = magic
        if (currentMagic is fmj.magic.MagicRestore) {
            // 恢复魔法：只消耗一次MP，对所有目标应用效果
            if (attacker.mp >= currentMagic.costMp) {
                attacker.mp = attacker.mp - currentMagic.costMp
                mTargets.forEach {
                    currentMagic.applyEffect(attacker, it)
                }
            }
        } else {
            // 其他类型的群体辅助魔法，暂时保持原逻辑
            mTargets.forEach {
                magic.use(attacker, it)
            }
        }
        mRaiseAnimations.addAll(mTargets.map { it.diffToAnimation(false) })
    }

    override fun update(delta: Long): Boolean {
        super.update(delta)
        when (state) {
            STATE_PRE -> if (mCurrentFrame < 10) {
                if (mAttacker is Player) {
                    mAttacker!!.fightingSprite!!.currentFrame = mCurrentFrame * 3 / 10 + 6
                } else {
                    mAttacker!!.setCombatPos(ox + 2, oy + 2)
                }
            } else {
                state = STATE_ANI
            }

            STATE_ANI -> if (!animation.update(delta)) { // 魔法动画完成
                state = STATE_AFT
                if (mAttacker is Player) {
                    (mAttacker as Player).setFrameByState()
                } else {
                    mAttacker!!.fightingSprite!!.move(-2, -2)
                }
            }

            STATE_AFT -> return updateRaiseAnimation(delta)
        }//			break;
        return true
    }

    override fun draw(canvas: Canvas) {
        if (state == STATE_ANI) {
            println("ActionMagicHelpAll: 绘制动画 at ($mAnix, $mAniy)")
            // 多目标 SRS 按 3 槽满员编队绘制：以特效视觉锚点对准编队质心，
            // 并按实际人数压缩各列偏移，使每列落在角色身上。
            animation.drawAtTargetScaled(
                canvas, mAnix, mAniy, animationScaleX, animationScaleY, mTargets.size)
        } else if (state == STATE_AFT) {
            drawRaiseAnimation(canvas)
        }
    }

    override fun rollbackToPhysical(): Action {
        val attacker = mAttacker!!
        return ActionNop(attacker)
    }

    companion object {

        private val STATE_PRE = 1 // 起手动画
        private val STATE_ANI = 2 // 魔法动画
        private val STATE_AFT = 3 // 伤害动画
    }

}
