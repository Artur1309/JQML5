import QtQuick 2.15

// Stage H demo: HoverHandler, WheelHandler, PinchHandler
Item {
  id: root
  width: 800
  height: 560

  // ── Background ──────────────────────────────────────────────────────────────
  Rectangle {
    anchors.fill: root
    color: "#1a1a2e"
  }

  // ── Title ───────────────────────────────────────────────────────────────────
  Text {
    x: 20; y: 14
    text: "PointerHandlers demo – Hover · Wheel · Pinch (ctrl+scroll)"
    color: "#c0c0d0"
    font.pixelSize: 14
  }

  // ── Section: HoverHandler ───────────────────────────────────────────────────

  Text {
    x: 20; y: 50
    text: "HoverHandler – move the pointer over each rectangle"
    color: "#8888aa"
    font.pixelSize: 12
  }

  Repeater {
    model: 4
    delegate: Rectangle {
      id: hoverBox
      x: 20 + index * 140
      y: 75
      width: 120
      height: 80
      radius: 8
      color: hoverBox.hovered ? "#4a79ff" : "#16213e"

      // NOTE: 'hovered' is read from the HoverHandler bound to this item
      property bool hovered: hover.hovered

      Text {
        anchors.centerIn: parent
        text: hoverBox.hovered ? "Hovering!" : "Hover me"
        color: "#ffffff"
        font.pixelSize: 11
      }

      HoverHandler {
        id: hover
        width: 120
        height: 80
      }
    }
  }

  // ── Section: WheelHandler ───────────────────────────────────────────────────

  Text {
    x: 20; y: 180
    text: "WheelHandler – scroll inside the blue area to zoom the indicator"
    color: "#8888aa"
    font.pixelSize: 12
  }

  Rectangle {
    id: wheelZone
    x: 20; y: 205
    width: 300; height: 160
    radius: 8
    color: "#0f3460"

    property real zoom: 1.0

    Text {
      anchors.top: parent.top
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.topMargin: 8
      text: "Scroll zone"
      color: "#8888aa"
      font.pixelSize: 11
    }

    // Visual indicator that shows the current zoom level
    Rectangle {
      id: zoomBox
      anchors.centerIn: parent
      width: 60 * wheelZone.zoom
      height: 60 * wheelZone.zoom
      radius: 4
      color: "#4a79ff"

      Text {
        anchors.centerIn: parent
        text: Math.round(wheelZone.zoom * 100) + "%"
        color: "#ffffff"
        font.pixelSize: 11
      }
    }

    WheelHandler {
      id: wheelH
      width: 300
      height: 160
      orientation: "vertical"
      onWheel: {
        var delta = event.deltaY > 0 ? -0.1 : 0.1;
        wheelZone.zoom = Math.max(0.3, Math.min(3.0, wheelZone.zoom + delta));
      }
    }
  }

  // ── Section: PinchHandler (ctrl+wheel) ─────────────────────────────────────

  Text {
    x: 360; y: 180
    text: "PinchHandler – ctrl+scroll to pinch-zoom the rectangle"
    color: "#8888aa"
    font.pixelSize: 12
  }

  Rectangle {
    id: pinchZone
    x: 360; y: 205
    width: 300; height: 160
    radius: 8
    color: "#0f3460"

    Text {
      anchors.top: parent.top
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.topMargin: 8
      text: "Ctrl+Scroll zone"
      color: "#8888aa"
      font.pixelSize: 11
    }

    Rectangle {
      id: pinchTarget
      anchors.centerIn: parent
      width: 80
      height: 80
      radius: 4
      color: "#e94560"

      Text {
        anchors.centerIn: parent
        text: Math.round(pinchH.scale * 100) + "%"
        color: "#ffffff"
        font.pixelSize: 11
      }
    }

    PinchHandler {
      id: pinchH
      width: 300
      height: 160
      onScaleChanged: {
        pinchTarget.width = 80 * pinchH.scale;
        pinchTarget.height = 80 * pinchH.scale;
      }
    }
  }

  // ── Section: Drag + Tap arbitration ─────────────────────────────────────────

  Text {
    x: 20; y: 400
    text: "Arbitration – tap (click without drag) vs drag the box"
    color: "#8888aa"
    font.pixelSize: 12
  }

  Rectangle {
    id: dragRoot
    x: 20; y: 430
    width: 760; height: 100
    radius: 6
    color: "#0d0d1a"

    property int tapCount: 0

    Text {
      x: 8; y: 6
      text: "Taps: " + dragRoot.tapCount
      color: "#8888aa"
      font.pixelSize: 11
    }

    Rectangle {
      id: draggable
      x: 20; y: 20
      width: 100; height: 60
      radius: 6
      color: dragH.active ? "#e94560" : "#4a79ff"

      Text {
        anchors.centerIn: parent
        text: dragH.active ? "Dragging" : "Tap or Drag"
        color: "#ffffff"
        font.pixelSize: 10
      }

      TapHandler {
        id: tapH
        width: 100
        height: 60
        z: 1
        onTapped: { dragRoot.tapCount = dragRoot.tapCount + 1; }
      }

      DragHandler {
        id: dragH
        width: 100
        height: 60
        z: 0
        dragTarget: draggable
      }
    }
  }
}
