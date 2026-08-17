package fmj.goods

import fmj.characters.BuffMan
import fmj.characters.FightingCharacter
import fmj.characters.Player

/**
 * 12兴奋剂
 * @author Chen
 */
class GoodsStimulant : BaseGoods(), IEatMedicine {

    private var mdfPercent: Int = 0
    private var matPercent: Int = 0
    private var mSpeedPercent: Int = 0
    private var mForAll: Boolean = false
    private val buff = BuffMan()

    override fun setOtherData(buf: ByteArray, offset: Int) {
        mdfPercent = buf[offset + 0x18].toInt() and 0xff
        matPercent = buf[offset + 0x19].toInt() and 0xff
        mSpeedPercent = buf[offset + 0x1b].toInt() and 0xff
        mForAll = buf[offset + 0x1c].toInt() and 0x10 != 0

        val at = buff.getBuffs(FightingCharacter.BUFF_MASK_GONG).first()
        val df = buff.getBuffs(FightingCharacter.BUFF_MASK_FANG).first()
        val speed = buff.getBuffs(FightingCharacter.BUFF_MASK_SU).first()
        at.value = -matPercent
        df.value = -mdfPercent
        speed.value = -mSpeedPercent
        at.round = sumRound
        df.round = sumRound
        speed.round = sumRound
    }

    override fun eat(player: Player) {
        player.beAttackedWithBuff(buff, 0)
    }

    override fun effectAll(): Boolean {
        return mForAll
    }
}
