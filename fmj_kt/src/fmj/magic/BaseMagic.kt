package fmj.magic

import fmj.characters.FightingCharacter
import fmj.lib.DatLib
import fmj.lib.ResBase
import fmj.lib.ResSrs

import java.gbkString

abstract class BaseMagic : ResBase() {

    /**
     * 获取魔法的持续回合
     * @return
     */
    var roundNum: Int = 0
        private set // 持续回合

    /**
     * 魔方是否影响全体
     * @return
     */
    var isForAll: Boolean = false
        private set // 是否影响全体

    /**
     * 魔方耗费真气
     * @return
     */
    var costMp: Int = 0
        private set // 耗费真气

    /**
     * 战斗中使用魔法时播放的动画
     * @return
     */
    var magicAni: ResSrs? = null
        private set // 魔法动画

    var magicName: String = ""
        private set // 魔法名

    var magicDescription: String = ""
        private set  // 魔方描述

    protected abstract fun setOtherData(buf: ByteArray, offset: Int)

    override fun setData(buf: ByteArray, offset: Int) {
        type = buf[offset].toInt() and 0xFF
        index = buf[offset + 1].toInt() and 0xFF
        roundNum = buf[offset + 3].toInt() and 0x7f
        isForAll = buf[offset + 3].toInt() and 0x80 != 0
        costMp = buf[offset + 4].toInt() and 0xFF // 无符号：百火炼金术等高耗蓝读成负数会反向回蓝
        val aniRes = DatLib.getRes(DatLib.ResType.SRS, 2, buf[offset + 5].toInt() and 0xFF, false)
        magicAni = if (aniRes is ResSrs) aniRes else {
            println("Warning: Failed to load magic animation SRS for magic ${buf[offset + 5].toInt() and 0xFF}")
            ResSrs() // 使用空的 ResSrs
        }
        magicName = Companion.getString(buf, offset + 6)
        val len = buf[offset + 2].toInt() and 0xff
        val descriptionStart = offset + 0x1a
        val descriptionLength = minOf(len - 0x1a, 0x70 - 0x1a)
        magicDescription = if (descriptionLength > 0) {
            val descriptionBytes = buf.copyOfRange(descriptionStart, descriptionStart + descriptionLength)
            val nulIndex = descriptionBytes.indexOfFirst { it == 0.toByte() }
            val boundedLength = if (nulIndex >= 0) nulIndex else descriptionLength
            buf.gbkString(descriptionStart, boundedLength)
        } else {
            ""
        }
        setOtherData(buf, offset)
    }

    open fun use(src: FightingCharacter, dst: FightingCharacter) {

    }

}
