// Step-C demo: Loader + Connections + Timer
//
// Demonstrates:
//   * Loader switching between two pages (PageA / PageB)
//   * Timer triggering an automatic page-flip every 2 seconds
//   * Connections listening to the button's clicked signal
//   * BindingElement conditionally overriding the background colour

import QtQuick 2.15

Item {
  id: root
  width: 640
  height: 480

  // ── background ─────────────────────────────────────────────────────────────
  Rectangle {
    id: bg
    anchors.fill: root
    color: showPageA ? "#f0f8e8" : "#e8eef8"
    property bool showPageA: true
  }

  // ── state flags ────────────────────────────────────────────────────────────
  property bool showPageA: true
  property int  flipCount: 0

  // ── Loader – swaps content page ────────────────────────────────────────────
  Loader {
    id: pageLoader
    x: 120
    y: 80
    width: 400
    height: 260
    sourceComponent: showPageA ? pageAComp : pageBComp
    onLoaded: {
      flipCount = flipCount + 1
    }
  }

  Component {
    id: pageAComp
    PageA {
      width: 400
      height: 260
    }
  }

  Component {
    id: pageBComp
    PageB {
      width: 400
      height: 260
    }
  }

  // ── Timer – auto-flip every 2 s ────────────────────────────────────────────
  Timer {
    id: flipTimer
    interval: 2000
    repeat: true
    running: true
    onTriggered: {
      showPageA = !showPageA
    }
  }

  // ── Manual toggle button ────────────────────────────────────────────────────
  Rectangle {
    id: toggleBtn
    x: 220
    y: 380
    width: 200
    height: 48
    radius: 8
    color: btnArea.pressed ? "#1a5fac" : "#2979d8"

    Text {
      anchors.centerIn: parent
      text: "Switch Page"
      color: "#ffffff"
      font: { pixelSize: 16 }
    }

    MouseArea {
      id: btnArea
      anchors.fill: parent
      onClicked: {
        showPageA = !showPageA
      }
    }
  }

  // ── Connections – react to button clicks ────────────────────────────────────
  Connections {
    target: btnArea
    onClicked: {
      flipTimer.restart()
    }
  }

  // ── Flip counter label ──────────────────────────────────────────────────────
  Text {
    x: 20
    y: 20
    text: "Flips: " + flipCount
    font: { pixelSize: 18 }
    color: "#333333"
  }

  // ── Loader status label ─────────────────────────────────────────────────────
  Text {
    x: 20
    y: 50
    text: "Loader status: " + pageLoader.status
    font: { pixelSize: 14 }
    color: "#666666"
  }
}
