import QtQuick 2.0

// Flickable demo – showcases drag, wheel, kinetic flick and bounds behaviour.
//
// Controls (top bar):
//   StopAtBounds / DragOverBounds / OvershootBounds buttons toggle
//   the bounds behaviour of both Flickable instances.
//
// Left panel  – vertical Flickable with 20 coloured tiles
// Right panel – horizontal Flickable with 12 wide tiles

Item {
    id: root
    width: 960
    height: 640

    // -----------------------------------------------------------------------
    // Header / controls
    // -----------------------------------------------------------------------
    Rectangle {
        id: header
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        height: 48
        color: "#1a1a2e"

        Text {
            anchors.verticalCenter: parent.verticalCenter
            x: 16
            text: "Flickable demo  –  current bounds: " + boundsLabel.text
            color: "#ffffff"
            font.pixelSize: 14
        }

        Text {
            id: boundsLabel
            visible: false
            text: "OvershootBounds"
        }

        // Stop button
        Rectangle {
            id: btnStop
            x: 360; width: 140; height: 32
            anchors.verticalCenter: parent.verticalCenter
            color: "#4a79ff"
            radius: 4
            Text { anchors.centerIn: parent; text: "StopAtBounds"; color: "#fff"; font.pixelSize: 12 }
            MouseArea {
                anchors.fill: parent
                onClicked: {
                    boundsLabel.text = "StopAtBounds"
                    vFlick.boundsBehavior  = "StopAtBounds"
                    hFlick.boundsBehavior  = "StopAtBounds"
                }
            }
        }

        // DragOver button
        Rectangle {
            x: 510; width: 150; height: 32
            anchors.verticalCenter: parent.verticalCenter
            color: "#4a79ff"
            radius: 4
            Text { anchors.centerIn: parent; text: "DragOverBounds"; color: "#fff"; font.pixelSize: 12 }
            MouseArea {
                anchors.fill: parent
                onClicked: {
                    boundsLabel.text = "DragOverBounds"
                    vFlick.boundsBehavior  = "DragOverBounds"
                    hFlick.boundsBehavior  = "DragOverBounds"
                }
            }
        }

        // Overshoot button
        Rectangle {
            x: 670; width: 160; height: 32
            anchors.verticalCenter: parent.verticalCenter
            color: "#4a79ff"
            radius: 4
            Text { anchors.centerIn: parent; text: "OvershootBounds"; color: "#fff"; font.pixelSize: 12 }
            MouseArea {
                anchors.fill: parent
                onClicked: {
                    boundsLabel.text = "OvershootBounds"
                    vFlick.boundsBehavior  = "OvershootBounds"
                    hFlick.boundsBehavior  = "OvershootBounds"
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Left panel – vertical Flickable
    // -----------------------------------------------------------------------
    Rectangle {
        id: leftPanel
        anchors.top: header.bottom
        anchors.bottom: root.bottom
        anchors.left: root.left
        width: 480
        color: "#f5f5f5"

        Text {
            x: 8; y: 8
            text: "Vertical Flickable (drag / wheel / flick)"
            font.pixelSize: 13
            color: "#333333"
        }

        Flickable {
            id: vFlick
            x: 8; y: 30
            width: 464
            height: parent.height - 38
            contentWidth: 464
            contentHeight: 20 * 70   // 20 tiles × 70px each
            clip: true
            flickableDirection: "VerticalFlick"
            boundsBehavior: "OvershootBounds"

            // 20 coloured tiles
            Rectangle { y: 0;    height: 64; width: 440; x: 12; color: "#ff6b6b"; radius: 6; Text { anchors.centerIn: parent; text: "Tile 1";  color: "#fff"; font.pixelSize: 14 } }
            Rectangle { y: 70;   height: 64; width: 440; x: 12; color: "#ffa94d"; radius: 6; Text { anchors.centerIn: parent; text: "Tile 2";  color: "#fff"; font.pixelSize: 14 } }
            Rectangle { y: 140;  height: 64; width: 440; x: 12; color: "#ffe066"; radius: 6; Text { anchors.centerIn: parent; text: "Tile 3";  color: "#333"; font.pixelSize: 14 } }
            Rectangle { y: 210;  height: 64; width: 440; x: 12; color: "#69db7c"; radius: 6; Text { anchors.centerIn: parent; text: "Tile 4";  color: "#fff"; font.pixelSize: 14 } }
            Rectangle { y: 280;  height: 64; width: 440; x: 12; color: "#4dabf7"; radius: 6; Text { anchors.centerIn: parent; text: "Tile 5";  color: "#fff"; font.pixelSize: 14 } }
            Rectangle { y: 350;  height: 64; width: 440; x: 12; color: "#748ffc"; radius: 6; Text { anchors.centerIn: parent; text: "Tile 6";  color: "#fff"; font.pixelSize: 14 } }
            Rectangle { y: 420;  height: 64; width: 440; x: 12; color: "#f783ac"; radius: 6; Text { anchors.centerIn: parent; text: "Tile 7";  color: "#fff"; font.pixelSize: 14 } }
            Rectangle { y: 490;  height: 64; width: 440; x: 12; color: "#ff6b6b"; radius: 6; Text { anchors.centerIn: parent; text: "Tile 8";  color: "#fff"; font.pixelSize: 14 } }
            Rectangle { y: 560;  height: 64; width: 440; x: 12; color: "#ffa94d"; radius: 6; Text { anchors.centerIn: parent; text: "Tile 9";  color: "#fff"; font.pixelSize: 14 } }
            Rectangle { y: 630;  height: 64; width: 440; x: 12; color: "#ffe066"; radius: 6; Text { anchors.centerIn: parent; text: "Tile 10"; color: "#333"; font.pixelSize: 14 } }
            Rectangle { y: 700;  height: 64; width: 440; x: 12; color: "#69db7c"; radius: 6; Text { anchors.centerIn: parent; text: "Tile 11"; color: "#fff"; font.pixelSize: 14 } }
            Rectangle { y: 770;  height: 64; width: 440; x: 12; color: "#4dabf7"; radius: 6; Text { anchors.centerIn: parent; text: "Tile 12"; color: "#fff"; font.pixelSize: 14 } }
            Rectangle { y: 840;  height: 64; width: 440; x: 12; color: "#748ffc"; radius: 6; Text { anchors.centerIn: parent; text: "Tile 13"; color: "#fff"; font.pixelSize: 14 } }
            Rectangle { y: 910;  height: 64; width: 440; x: 12; color: "#f783ac"; radius: 6; Text { anchors.centerIn: parent; text: "Tile 14"; color: "#fff"; font.pixelSize: 14 } }
            Rectangle { y: 980;  height: 64; width: 440; x: 12; color: "#ff6b6b"; radius: 6; Text { anchors.centerIn: parent; text: "Tile 15"; color: "#fff"; font.pixelSize: 14 } }
            Rectangle { y: 1050; height: 64; width: 440; x: 12; color: "#ffa94d"; radius: 6; Text { anchors.centerIn: parent; text: "Tile 16"; color: "#fff"; font.pixelSize: 14 } }
            Rectangle { y: 1120; height: 64; width: 440; x: 12; color: "#ffe066"; radius: 6; Text { anchors.centerIn: parent; text: "Tile 17"; color: "#333"; font.pixelSize: 14 } }
            Rectangle { y: 1190; height: 64; width: 440; x: 12; color: "#69db7c"; radius: 6; Text { anchors.centerIn: parent; text: "Tile 18"; color: "#fff"; font.pixelSize: 14 } }
            Rectangle { y: 1260; height: 64; width: 440; x: 12; color: "#4dabf7"; radius: 6; Text { anchors.centerIn: parent; text: "Tile 19"; color: "#fff"; font.pixelSize: 14 } }
            Rectangle { y: 1330; height: 64; width: 440; x: 12; color: "#748ffc"; radius: 6; Text { anchors.centerIn: parent; text: "Tile 20"; color: "#fff"; font.pixelSize: 14 } }
        }
    }

    // -----------------------------------------------------------------------
    // Right panel – horizontal Flickable
    // -----------------------------------------------------------------------
    Rectangle {
        id: rightPanel
        anchors.top: header.bottom
        anchors.bottom: root.bottom
        anchors.left: leftPanel.right
        anchors.right: root.right
        color: "#e8eaf6"

        Text {
            x: 8; y: 8
            text: "Horizontal Flickable (drag / wheel / flick)"
            font.pixelSize: 13
            color: "#333333"
        }

        Flickable {
            id: hFlick
            x: 8; y: 30
            width: parent.width - 16
            height: parent.height - 38
            contentWidth: 12 * 180   // 12 tiles × 180px each
            contentHeight: parent.height - 38
            clip: true
            flickableDirection: "HorizontalFlick"
            boundsBehavior: "OvershootBounds"

            // 12 coloured tiles side by side
            Rectangle { x: 0;    width: 172; height: 200; y: 20; color: "#ff6b6b"; radius: 6; Text { anchors.centerIn: parent; text: "Card 1";  color: "#fff"; font.pixelSize: 14 } }
            Rectangle { x: 180;  width: 172; height: 200; y: 20; color: "#ffa94d"; radius: 6; Text { anchors.centerIn: parent; text: "Card 2";  color: "#fff"; font.pixelSize: 14 } }
            Rectangle { x: 360;  width: 172; height: 200; y: 20; color: "#ffe066"; radius: 6; Text { anchors.centerIn: parent; text: "Card 3";  color: "#333"; font.pixelSize: 14 } }
            Rectangle { x: 540;  width: 172; height: 200; y: 20; color: "#69db7c"; radius: 6; Text { anchors.centerIn: parent; text: "Card 4";  color: "#fff"; font.pixelSize: 14 } }
            Rectangle { x: 720;  width: 172; height: 200; y: 20; color: "#4dabf7"; radius: 6; Text { anchors.centerIn: parent; text: "Card 5";  color: "#fff"; font.pixelSize: 14 } }
            Rectangle { x: 900;  width: 172; height: 200; y: 20; color: "#748ffc"; radius: 6; Text { anchors.centerIn: parent; text: "Card 6";  color: "#fff"; font.pixelSize: 14 } }
            Rectangle { x: 1080; width: 172; height: 200; y: 20; color: "#f783ac"; radius: 6; Text { anchors.centerIn: parent; text: "Card 7";  color: "#fff"; font.pixelSize: 14 } }
            Rectangle { x: 1260; width: 172; height: 200; y: 20; color: "#ff6b6b"; radius: 6; Text { anchors.centerIn: parent; text: "Card 8";  color: "#fff"; font.pixelSize: 14 } }
            Rectangle { x: 1440; width: 172; height: 200; y: 20; color: "#ffa94d"; radius: 6; Text { anchors.centerIn: parent; text: "Card 9";  color: "#fff"; font.pixelSize: 14 } }
            Rectangle { x: 1620; width: 172; height: 200; y: 20; color: "#ffe066"; radius: 6; Text { anchors.centerIn: parent; text: "Card 10"; color: "#333"; font.pixelSize: 14 } }
            Rectangle { x: 1800; width: 172; height: 200; y: 20; color: "#69db7c"; radius: 6; Text { anchors.centerIn: parent; text: "Card 11"; color: "#fff"; font.pixelSize: 14 } }
            Rectangle { x: 1980; width: 172; height: 200; y: 20; color: "#4dabf7"; radius: 6; Text { anchors.centerIn: parent; text: "Card 12"; color: "#fff"; font.pixelSize: 14 } }
        }
    }
}
