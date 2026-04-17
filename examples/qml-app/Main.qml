import QtQuick 2.15
import QtQml 2.15
import QtQuick.Controls 2.15
import "./components"

Item {
  id: root
  width: 960
  height: 640

  property int counter: 0
  property string assetUrl: "./assets/logo.txt"

  Rectangle {
    id: background
    anchors.fill: root
    color: "#fafbfd"
    source: "./assets/logo.txt"
  }

  Rectangle {
    id: button
    x: 40
    y: 40
    width: 220
    height: 72
    color: counter % 2 === 0 ? "#4a90e2" : "#7b61ff"
    borderColor: "#2d2f36"
    borderWidth: 2

    MouseArea {
      anchors.fill: button
      onClicked: {
        counter = counter + 1;
        let total = 0;
        for (let i = 0; i < 3; i += 1) {
          total += i;
        }
        console.log('Button clicked', counter, total, root.assetUrl);
      }
    }
  }

  Loader {
    id: badgeLoader
    x: 300
    y: 40
    sourceComponent: Component {
      Rectangle {
        width: 180
        height: 72
        radius: 12
        color: "#fff6d6"
        borderColor: "#f0c36b"
        borderWidth: 1
      }
    }
  }

  StatusPanel {
    id: statusPanel
    x: 40
    y: 150
    width: 380
    height: 180
    count: counter
    logoSource: "./assets/logo.txt"
  }
}
