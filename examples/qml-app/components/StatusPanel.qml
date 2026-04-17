import QtQuick 2.15
import QtQml 2.15

Rectangle {
  id: statusRoot
  property int count: 0
  property string logoSource: ""

  color: count % 2 === 0 ? "#ffffff" : "#f0f4ff"
  borderColor: "#c5d0e6"
  borderWidth: 1
  radius: 10

  Rectangle {
    anchors.fill: statusRoot
    anchors.margins: 8
    color: "transparent"
    source: logoSource
  }
}
