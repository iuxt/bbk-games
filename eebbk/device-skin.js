/* 朗文4980照片坐标。原图为2532×1170，以下使用等比的2048×946坐标系。
   保留原图，通过显示窗口裁掉机身外的桌面与播放器边框；不重绘键帽。
   rect 为键帽中心 x/y 与宽/高，单位均为照片坐标像素。 */
(function(global) {
  'use strict';
  const photo = {
    src: 'assets/longman-4980.png',
    width: 2048, height: 946,
    crop: { x: 740, y: 26, width: 835, height: 920 },
    lcd: { x: 827, y: 132, width: 505, height: 250 },
    screen: { x: 886, y: 139, width: 391, height: 236.0754717 },
  };
  const keys = [
    [0, '开关', 897, 585, 52, 42],
    [1, '目录', 970, 585, 52, 42],
    [2, '双解', 1043, 586, 52, 42],
    [3, '十万', 1117, 586, 52, 42],
    [4, '汉英', 1190, 587, 52, 42],
    [5, '对话', 1264, 588, 52, 42],
    [6, '下载', 1339, 589, 52, 42],
    [7, '发音', 1414, 590, 52, 42],
    [8, '1', 820, 644, 43, 44],
    [9, '2', 895, 644, 43, 44],
    [10, '3', 970, 644, 43, 44],
    [11, '4', 1045, 644, 43, 44],
    [12, '5', 1118, 645, 43, 44],
    [13, '6', 1190, 645, 43, 44],
    [14, '7', 1265, 645, 43, 44],
    [15, '8', 1340, 646, 43, 44],
    [48, '9', 1414, 646, 43, 44],
    [49, '0', 1488, 647, 43, 44],
    [16, 'Q', 820, 698, 53, 41],
    [17, 'W', 887, 698, 53, 41],
    [18, 'E', 954, 698, 53, 41],
    [19, 'R', 1021, 698, 53, 41],
    [20, 'T', 1088, 699, 53, 41],
    [21, 'Y', 1155, 699, 53, 41],
    [22, 'U', 1222, 699, 53, 41],
    [23, 'I', 1289, 700, 53, 41],
    [50, 'O', 1357, 700, 53, 41],
    [51, 'P', 1424, 700, 53, 41],
    [54, '空格', 1489, 701, 54, 41],
    [24, 'A', 817, 755, 53, 40],
    [25, 'S', 884, 755, 53, 40],
    [26, 'D', 950, 755, 53, 40],
    [27, 'F', 1016, 755, 53, 40],
    [28, 'G', 1082, 755, 53, 40],
    [29, 'H', 1148, 756, 53, 40],
    [30, 'J', 1215, 756, 53, 40],
    [31, 'K', 1280, 756, 53, 40],
    [52, 'L', 1344, 757, 53, 40],
    [53, '上', 1410, 763, 48, 56],
    [58, '上页', 1493, 763, 48, 56],
    [32, '输入法', 817, 813, 55, 41],
    [33, 'Z', 885, 813, 55, 41],
    [34, 'X', 952, 813, 55, 41],
    [35, 'C', 1020, 813, 55, 41],
    [36, 'V', 1088, 814, 55, 41],
    [37, 'B', 1155, 814, 55, 41],
    [38, 'N', 1224, 814, 55, 41],
    [39, 'M', 1293, 814, 55, 41],
    [55, '左', 1366, 814, 59, 46],
    [57, '右', 1454, 814, 60, 46],
    [40, '中英符', 817, 871, 55, 41],
    [41, '帮助', 882, 871, 55, 41],
    [42, '查找', 949, 871, 55, 41],
    [43, '插入', 1014, 871, 55, 41],
    [44, '修改', 1080, 871, 55, 41],
    [45, '删除', 1146, 871, 55, 41],
    [46, '跳出', 1220, 871, 64, 44],
    [47, '输入', 1310, 873, 115, 44],
    [56, '下', 1410, 865, 50, 54],
    [59, '下页', 1493, 865, 50, 54],
  ].map(function(row) {
    return { code: row[0], label: row[1], rect: row.slice(2) };
  });

  function position(rect) {
    return {
      left: rect[0] - rect[2] / 2 - photo.crop.x,
      top: rect[1] - rect[3] / 2 - photo.crop.y,
      width: rect[2], height: rect[3],
    };
  }

  function mount(host) {
    const doc = host.ownerDocument;
    const layer = doc.createElement('div');
    layer.className = 'device-photo-layer';
    const img = doc.createElement('img');
    img.className = 'device-photo';
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    layer.appendChild(img);
    const controls = doc.createElement('div');
    controls.className = 'device-hotspots';
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', '朗文4980原机键盘');
    function addButton(label, rect, code, action) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'device-key';
      button.setAttribute('aria-label', label);
      if (code !== null) button.dataset.key = String(code);
      if (action) button.dataset.deviceAction = action;
      const bounds = position(rect);
      Object.keys(bounds).forEach(function(name) { button.style[name] = bounds[name] + 'px'; });
      controls.appendChild(button);
    }
    keys.forEach(function(key) {
      addButton(key.label, key.rect, key.code, key.code === 0 ? 'power' : '');
    });
    addButton('RESET 重启', [1487, 602, 20, 20], null, 'reset');
    layer.appendChild(controls);
    host.appendChild(layer);
    function resize() {
      const width = host.getBoundingClientRect().width;
      if (width > 0) layer.style.transform = 'scale(' + width / photo.crop.width + ')';
    }
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    return {
      layer: layer,
      show: function() {
        if (!img.getAttribute('src')) img.src = photo.src;
        resize();
      },
    };
  }
  global.BBK4980Skin = { photo: photo, keys: keys, position: position, mount: mount };
}(typeof window !== 'undefined' ? window : globalThis));
