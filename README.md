# Brainpile
（开发中）一个私有化的数字资产管理系统

## 特性
- 在Telegram中，无论一组图中有几张图，用户只能对它点一个reaction，且bot看来这个reaction是点到第一张图上的；bot可以给组图内多个item点reaction，但用户只能看到一个reaction。所以：
  - bot只会给组图的第一张图点reaction，尽管每张图都是一个item
  - 只有整组图处理完毕，bot才会点❤️；如果有一张图处理失败，bot就会给整组图点👎
  - 用户对组图点的reaction，bot会视为对每张图都点了相同的reaction
  - 已知问题：若有一张图处理失败，其它图还是会被正常导入。需要编写tasks的回滚策略。

