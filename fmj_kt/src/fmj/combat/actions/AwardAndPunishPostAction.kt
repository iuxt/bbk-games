package fmj.combat.actions

import fmj.characters.FightingCharacter
import fmj.characters.Player
import fmj.combat.anim.Animation
import fmj.combat.anim.RaiseAnimation
import graphics.Canvas

class AwardAndPunishPostAction(attackers: Iterable<FightingCharacter>): PostAction() {
    var animations: MutableList<Animation> = arrayListOf()
    init {
        for (attacker in attackers) {
            if (!attacker.isAlive) {
                continue
            }
            if (attacker is Player) {
                attacker.backupStatus()
                val decs = attacker.equipmentsArray
                        .sliceArray(0..1)
                        .filterNotNull()
                if (!decs.isEmpty()) {
                    decs.forEach {
                        it.affect(attacker)
                    }
                    // hp/mp setter 钳制到上限，因此 hp - backup.hp 是实际
                    // 恢复量：满血/满真气不飘字，近满只飘实际值。
                    // （不用 diffToAnimation：deltaSinceBackup 是未钳制的
                    // 名义值，满血时仍会飘 "+N"。）
                    val hpDelta = attacker.hp - attacker.backup.hp
                    if (hpDelta != 0) {
                        animations.add(RaiseAnimation(attacker.combatX, attacker.combatTop, hpDelta, 0))
                    }
                    // 装饰品每回合回真气此前没有任何飘字（diff.mp 被丢弃）。
                    val mpDelta = attacker.mp - attacker.backup.mp
                    if (mpDelta != 0) {
                        animations.add(RaiseAnimation(attacker.combatX, attacker.combatTop, mpDelta, 0))
                    }
                }
            }

            if (attacker.isPoisoned) {
                attacker.backupStatus()
                if (attacker.hp == 1) {
                    attacker.hp = 0
                } else {
                    val hp = attacker.hp.toDouble() * 0.75
                    attacker.hp = hp.toInt()
                }
                animations.add(attacker.diffToAnimation())
            }
        }
    }

    override fun update(delta: Long): Boolean {
        if (animations.isEmpty())
            return false
        if (!animations.first().update(delta))
            animations.removeAt(0)
        return !animations.isEmpty()
    }

    override fun draw(canvas: Canvas) {
        if (animations.isEmpty())
            return
        animations.first().draw(canvas)
    }

}