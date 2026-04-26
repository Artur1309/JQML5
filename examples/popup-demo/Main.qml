import QtQuick 2.15
import QtQuick.Controls 2.15

// Popup / Dialog / Menu demo – Stage I
Item {
  id: root
  width: 800
  height: 600

  // ── Background ──────────────────────────────────────────────────────────────
  Rectangle {
    anchors.fill: root
    color: "#f2f4f8"
  }

  // ── Title ───────────────────────────────────────────────────────────────────
  Label {
    x: 40; y: 24
    text: "JQML5 Popup / Dialog / Menu Demo – Stage I"
    color: "#1a1a2e"
    font.pixelSize: 20
    font.bold: true
  }

  // ── Button: open Dialog ─────────────────────────────────────────────────────
  Label {
    x: 40; y: 80
    text: "Click the button to open a modal Dialog:"
    color: "#444466"
  }

  Button {
    id: openDialogBtn
    x: 40; y: 108
    width: 160; height: 36
    text: "Open Dialog"
    onClicked: {
      confirmDialog.open()
    }
  }

  // Status label updated by dialog result
  Label {
    id: dialogStatus
    x: 220; y: 116
    text: "(no result yet)"
    color: "#555577"
  }

  // ── Button: open Menu ───────────────────────────────────────────────────────
  Label {
    x: 40; y: 172
    text: "Right-click (or click below) to open a context Menu:"
    color: "#444466"
  }

  Button {
    id: openMenuBtn
    x: 40; y: 200
    width: 160; height: 36
    text: "Open Menu"
    onClicked: {
      contextMenu.x = openMenuBtn.x
      contextMenu.y = openMenuBtn.y + openMenuBtn.height + 4
      contextMenu.open()
    }
  }

  Label {
    id: menuStatus
    x: 220; y: 208
    text: "(no item selected)"
    color: "#555577"
  }

  // ── Dialog ──────────────────────────────────────────────────────────────────
  Dialog {
    id: confirmDialog
    title: "Confirm Action"
    width: 360
    height: 180
    modal: true
    dim: true
    closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside
    standardButtons: Dialog.Ok | Dialog.Cancel

    // Centre in the root item
    anchors.centerIn: root

    onAccepted: {
      dialogStatus.text = "Dialog accepted ✓"
    }
    onRejected: {
      dialogStatus.text = "Dialog rejected ✗"
    }
    onClosed: {
      // nothing extra needed; status already set via accepted/rejected
    }
  }

  // ── Context Menu ─────────────────────────────────────────────────────────────
  Menu {
    id: contextMenu
    width: 200
    closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside

    MenuItem {
      text: "Copy"
      onTriggered: { menuStatus.text = "Copy selected" }
    }
    MenuItem {
      text: "Paste"
      onTriggered: { menuStatus.text = "Paste selected" }
    }
    MenuItem {
      text: "Delete"
      onTriggered: { menuStatus.text = "Delete selected" }
    }
  }

  // Right-click on the background opens the context menu
  MouseArea {
    anchors.fill: root
    acceptedButtons: Qt.RightButton
    onClicked: {
      contextMenu.x = mouseX
      contextMenu.y = mouseY
      contextMenu.open()
    }
  }
}
