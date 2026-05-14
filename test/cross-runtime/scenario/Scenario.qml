import QtQuick 2.15

Item {
  id: root
  width: 400
  height: 300
  focus: true
  activeFocusOnTab: true

  property int clickCount: 0
  property string keyTrace: ""
  property string stateText: "clicks=" + clickCount + ";keys=" + keyTrace

  Rectangle {
    id: target
    x: 60
    y: 60
    width: 140
    height: 80
    radius: 8
    color: clickCount % 2 === 0 ? "#3A86FF" : "#FF006E"

    Text {
      anchors.centerIn: parent
      text: clickCount === 0 ? "Tap" : "Tapped " + clickCount
      color: "#ffffff"
    }

    MouseArea {
      anchors.fill: parent
      onClicked: {
        root.clickCount += 1
        root.forceActiveFocus()
        console.log("[CROSS] click " + root.stateText)
      }
    }
  }

  Keys.onPressed: {
    var key = ""
    if (typeof event.key === "number") {
      if (event.key === Qt.Key_A || event.key === 65) {
        key = "A"
      } else if (event.key === Qt.Key_B || event.key === 66) {
        key = "B"
      }
    } else {
      var value = String(event.key || "").toUpperCase()
      if (value === "A" || value === "B") {
        key = value
      }
    }

    if (key !== "") {
      root.keyTrace += key
      console.log("[CROSS] key " + root.stateText)
      event.accepted = true
    }
  }

  Text {
    x: 20
    y: 190
    text: "status=" + root.stateText
    color: "#111111"
  }
}
