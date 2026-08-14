package fmj.lib

import java.gbkString

/**
 * 每次new一个对象后，必须调用[ResBase.setData]方法
 *
 * @author Chen
 */
abstract class ResBase {
    var type: Int = 0
        protected set
    var index: Int = 0
        protected set

    /**
     * 每次new一个对象后，必须调用该方法填充各个字段
     *
     * @param buf
     * 资源的数据缓冲区
     * @param offset
     * 该资源在数组`buf`中的偏移位置，`buf[offset]` 为该资源的首字节
     */
    abstract fun setData(buf: ByteArray, offset: Int)

    companion object {

        /**
         * 获得GBK编码的字符串
         *
         * @param buf
         * @param start
         * 字符串的第一个字节
         * @return
         */
        fun getString(buf: ByteArray, start: Int): String {
            var i = 0
            while (buf[start + i].toInt() != 0)
                ++i
            return buf.gbkString(start, i)
        }

        /**
         * 两字节无符号整型
         * @param buf
         * @param start
         * @return
         */
        fun get2BytesInt(buf: ByteArray, start: Int): Int {
            return buf[start].toInt() and 0xFF or (buf[start + 1].toInt() shl 8 and 0xFF00)
        }

        /**
         * 两字节有符号整型
         * @param buf
         * @param start
         * @return
         */
        fun get2BytesSInt(buf: ByteArray, start: Int): Int {
            val i = buf[start].toInt() and 0xFF or (buf[start + 1].toInt() shl 8 and 0xFF00)
            return i.toShort().toInt()
        }

        fun get1ByteSInt(buf: ByteArray, start: Int): Int {
            // 伏魔记 .lib 中装备/药品的单字节属性增量（mMp/mHp/mdf/mlingli/
            // mSpeed/mLuck 等）按原码(sign-magnitude)存放：bit7 为符号位，
            // bit0..6 为数值（如金缕衣「身法-10」= 0x8a）。Kotlin ByteArray
            // 在 JS 侧是补码 Int8Array，直接读 0x8a 会得到 -118；先 &0xFF
            // 转无符号再按原码拆符号/数值。
            val b = buf[start].toInt() and 0xFF
            return if (b and 0x80 != 0) -(b and 0x7F) else b
        }
    }
}
