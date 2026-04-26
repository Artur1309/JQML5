import QtQuick 2.15

// Stage C demo: Focus / Keys / TapHandler / DragHandler
Item {
  id: root
  width: 800
  height: 500

  // ── Background ──────────────────────────────────────────────────────────────
  Rectangle {
    anchors.fill: root
    color: "#1a1a2e"
  }

  // ── Instructions ────────────────────────────────────────────────────────────
  Rectangle {
    x: 20
    y: 12
    width: 760
    height: 30
    color: "transparent"
  }

  // ── Focus box A ─────────────────────────────────────────────────────────────
  Rectangle {
    id: boxA
    x: 40
    y: 60
    width: 160
    height: 100
    radius: 8
    color: "#16213e"
    borderWidth: boxA.activeFocus ? 3 : 1
    borderColor: boxA.activeFocus ? "#4a79ff" : "#0f3460"
    activeFocusOnTab: true
    focusable: true

    Keys.onPressed: {
      if (event.key === "ArrowRight") { boxA.x = Math.min(boxA.x + 10, root.width - boxA.width - 40); event.accepted = true; }
      if (event.key === "ArrowLeft")  { boxA.x = Math.max(boxA.x - 10, 0);                             event.accepted = true; }
    }

    TapHandler {
      width: 160
      height: 100
      onTapped: {
        boxA.focus = true;
      }
    }
  }

  // ── Focus box B ─────────────────────────────────────────────────────────────
  Rectangle {
    id: boxB
    x: 240
    y: 60
    width: 160
    height: 100
    radius: 8
    color: "#16213e"
    borderWidth: boxB.activeFocus ? 3 : 1
    borderColor: boxB.activeFocus ? "#e74c3c" : "#0f3460"
    activeFocusOnTab: true
    focusable: true

    Keys.onPressed: {
      if (event.key === "ArrowUp")   { boxB.y = Math.max(boxB.y - 10, 0);                              event.accepted = true; }
      if (event.key === "ArrowDown") { boxB.y = Math.min(boxB.y + 10, root.height - boxB.height - 20); event.accepted = true; }
    }

    TapHandler {
      width: 160
      height: 100
      onTapped: {
        boxB.focus = true;
      }
    }
  }

  // ── Focus box C (Tab only, no click) ────────────────────────────────────────
  Rectangle {
    id: boxC
    x: 440
    y: 60
    width: 160
    height: 100
    radius: 8
    color: "#16213e"
    borderWidth: boxC.activeFocus ? 3 : 1
    borderColor: boxC.activeFocus ? "#27ae60" : "#0f3460"
    activeFocusOnTab: true
    focusable: true

    Keys.onPressed: {
      if (event.key === " " || event.key === "Enter") {
        boxC.color = boxC.color === "#16213e" ? "#27ae60" : "#16213e";
        event.accepted = true;
      }
    }
  }

  // ── Draggable rectangle ─────────────────────────────────────────────────────
  Rectangle {
    id: dragBox
    x: 40
    y: 220
    width: 120
    height: 120
    radius: 10
    color: drag.active ? "#7b52ab" : "#533483"
    borderColor: "#9b72cb"
    borderWidth: 2

    DragHandler {
      id: drag
      width: 120
      height: 120
    }
  }

  // ── Key log display ─────────────────────────────────────────────────────────
  Rectangle {
    id: logBox
    x: 560
    y: 220
    width: 200
    height: 120
    radius: 6
    color: "#0f3460"
    borderColor: "#16213e"
    borderWidth: 1
  }
}
