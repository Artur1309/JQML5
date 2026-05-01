import QtQuick 2.15
import QtQuick.Controls 2.15

// PR-C Demo: Loader + Connections + Timer
Item {
  id: root
  width: 800
  height: 600

  // ── Background ────────────────────────────────────────────────────────────
  Rectangle {
    anchors.fill: root
    color: "#f0f4ff"
  }

  // ── Title ─────────────────────────────────────────────────────────────────
  Label {
    x: 40; y: 20
    text: "JQML5 – Loader + Connections + Timer Demo (PR-C)"
    font.pixelSize: 18
    font.bold: true
    color: "#1a1a3e"
  }

  // ── Page state ────────────────────────────────────────────────────────────
  property int currentPage: 0   // 0=none, 1=pageA, 2=pageB
  property string statusText: "No page loaded"
  property int tickCount: 0

  // ── Page A component ──────────────────────────────────────────────────────
  Component {
    id: pageAComponent
    Rectangle {
      width: 340; height: 140
      radius: 10
      color: "#dce8ff"
      border.color: "#5577cc"
      border.width: 2
      Label {
        anchors.centerIn: parent
        text: "Page A"
        font.pixelSize: 22
        color: "#22336a"
        font.bold: true
      }
    }
  }

  // ── Page B component ──────────────────────────────────────────────────────
  Component {
    id: pageBComponent
    Rectangle {
      width: 340; height: 140
      radius: 10
      color: "#d8f5e2"
      border.color: "#44aa66"
      border.width: 2
      Label {
        anchors.centerIn: parent
        text: "Page B"
        font.pixelSize: 22
        color: "#1a5c35"
        font.bold: true
      }
    }
  }

  // ── Loader ────────────────────────────────────────────────────────────────
  Loader {
    id: pageLoader
    x: 40; y: 80
    width: 340; height: 160
    active: false
    onLoaded: {
      root.statusText = "Loaded: " + (currentPage === 1 ? "Page A" : "Page B")
    }
  }

  // ── Connections: react to Loader status changes ───────────────────────────
  Connections {
    target: pageLoader
    function onStatusChanged(status) {
      if (status === Loader.Null) {
        root.statusText = "Loader unloaded"
      }
    }
  }

  // ── Timer: auto-tick counter while Page A is loaded ───────────────────────
  Timer {
    id: tickTimer
    interval: 500
    repeat: true
    running: pageLoader.status === Loader.Ready && root.currentPage === 1
    onTriggered: {
      root.tickCount = root.tickCount + 1
    }
  }

  // ── Control buttons ───────────────────────────────────────────────────────
  Row {
    x: 40; y: 260
    spacing: 12

    Button {
      text: "Load Page A"
      width: 120; height: 36
      onClicked: {
        root.currentPage = 1
        root.tickCount = 0
        pageLoader.sourceComponent = pageAComponent
        pageLoader.active = true
      }
    }

    Button {
      text: "Load Page B"
      width: 120; height: 36
      onClicked: {
        root.currentPage = 2
        root.tickCount = 0
        pageLoader.sourceComponent = pageBComponent
        pageLoader.active = true
      }
    }

    Button {
      text: "Unload"
      width: 100; height: 36
      onClicked: {
        root.currentPage = 0
        root.tickCount = 0
        pageLoader.active = false
      }
    }
  }

  // ── Status display ────────────────────────────────────────────────────────
  Rectangle {
    x: 40; y: 320
    width: 500; height: 100
    radius: 8
    color: "#ffffff"
    border.color: "#cccce0"

    Column {
      anchors.fill: parent
      anchors.margins: 12
      spacing: 6

      Label {
        text: "Status: " + root.statusText
        font.pixelSize: 14
        color: "#333355"
      }

      Label {
        text: "Loader.status: " + pageLoader.status + " | progress: " + pageLoader.progress
        font.pixelSize: 13
        color: "#555577"
      }

      Label {
        text: "Timer ticks (Page A only): " + root.tickCount
        font.pixelSize: 13
        color: "#224422"
      }
    }
  }

  // ── Usage hint ────────────────────────────────────────────────────────────
  Label {
    x: 40; y: 440
    width: 700
    text: "• Click 'Load Page A' or 'Load Page B' to dynamically load a page into the Loader.\n" +
          "• Connections listen for Loader status changes and update the status label.\n" +
          "• When Page A is active, a Timer fires every 500 ms and increments the tick counter.\n" +
          "• Click 'Unload' to destroy the loaded item."
    font.pixelSize: 12
    color: "#667"
    wrapMode: Text.WordWrap
  }
}
