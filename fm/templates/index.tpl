<!doctype html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="启动 {{GAME_NAME}}">
    <title>启动 {{GAME_NAME}} · BBK 经典游戏</title>
    <script>
        (function () {
            var page = "pc.html";
            if (navigator.userAgent.match(/(iPhone|iPod|Android|ios|Mobile|ARM)/i)) {
                page = "m.html";
            }
            window.location.replace(page);
        })();
    </script>
</head>
<body>
    <noscript>
        <p>
            <a href="pc.html">桌面版</a>
            <a href="m.html">移动版</a>
        </p>
    </noscript>
</body>
</html>
