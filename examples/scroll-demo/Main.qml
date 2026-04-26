import QtQuick 2.0
import QtQuick.Controls 2.15

// Scroll demo – showcases ScrollBar attached to Flickable, ScrollView,
// and StackView navigation between two pages.

ApplicationWindow {
    id: root
    width: 960
    height: 640
    title: "Scroll Demo"
    color: "#f0f0f0"

    // -----------------------------------------------------------------------
    // Main StackView fills the window
    // -----------------------------------------------------------------------
    StackView {
        id: stack
        anchors.fill: parent

        // Initial page loaded on start
        Component.onCompleted: {
            stack.push(mainPage)
        }
    }

    // -----------------------------------------------------------------------
    // Page 1: Flickable with attached ScrollBars + ScrollView
    // -----------------------------------------------------------------------
    Component {
        id: mainPage
        Page {
            width: root.width
            height: root.height
            background: "#f0f0f0"

            Rectangle {
                id: pageHeader
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                height: 48
                color: "#1a1a2e"

                Text {
                    anchors.verticalCenter: parent.verticalCenter
                    x: 16
                    text: "Page 1 – Flickable + ScrollBars"
                    color: "#ffffff"
                    font.pixelSize: 14
                }

                Rectangle {
                    x: parent.width - 144
                    width: 128
                    height: 32
                    anchors.verticalCenter: parent.verticalCenter
                    color: "#4a79ff"
                    radius: 4
                    Text {
                        anchors.centerIn: parent
                        text: "Go to Page 2"
                        color: "#ffffff"
                        font.pixelSize: 12
                    }
                    MouseArea {
                        anchors.fill: parent
                        onClicked: stack.push(detailPage)
                    }
                }
            }

            // ---------------------------------------------------------------
            // Left panel: Flickable with a vertical ScrollBar attached
            // ---------------------------------------------------------------
            Rectangle {
                id: leftPanel
                anchors.top: pageHeader.bottom
                anchors.left: parent.left
                anchors.bottom: parent.bottom
                width: parent.width / 2 - 4
                color: "#ffffff"

                Flickable {
                    id: vFlick
                    anchors.fill: parent
                    anchors.rightMargin: 10
                    contentWidth: width
                    contentHeight: 30 * 60
                    clip: true
                    flickableDirection: "VerticalFlick"

                    ScrollBar.vertical: ScrollBar {
                        id: vBar
                        policy: "ScrollBarAsNeeded"
                    }

                    Column {
                        width: vFlick.width
                        spacing: 0

                        Repeater {
                            model: 30
                            Rectangle {
                                width: vFlick.width - 10
                                height: 56
                                color: index % 2 === 0 ? "#e8f0fe" : "#ffffff"
                                radius: 4
                                Text {
                                    anchors.verticalCenter: parent.verticalCenter
                                    x: 12
                                    text: "Row " + (index + 1)
                                    font.pixelSize: 13
                                    color: "#1a1a2e"
                                }
                            }
                        }
                    }
                }
            }

            // ---------------------------------------------------------------
            // Right panel: ScrollView wrapping tall content
            // ---------------------------------------------------------------
            Rectangle {
                id: rightPanel
                anchors.top: pageHeader.bottom
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                width: parent.width / 2 - 4
                color: "#ffffff"

                ScrollView {
                    anchors.fill: parent
                    contentWidth: parent.width - 20
                    contentHeight: 20 * 80

                    Column {
                        width: rightPanel.width - 20
                        spacing: 4

                        Repeater {
                            model: 20
                            Rectangle {
                                width: rightPanel.width - 20
                                height: 72
                                color: index % 2 === 0 ? "#fff3e0" : "#ffffff"
                                radius: 4
                                Text {
                                    anchors.verticalCenter: parent.verticalCenter
                                    x: 12
                                    text: "ScrollView Item " + (index + 1)
                                    font.pixelSize: 13
                                    color: "#1a1a2e"
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Page 2: detail page (StackView navigation target)
    // -----------------------------------------------------------------------
    Component {
        id: detailPage
        Page {
            width: root.width
            height: root.height
            background: "#e8f5e9"

            Rectangle {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                height: 48
                color: "#2e7d32"

                Text {
                    anchors.verticalCenter: parent.verticalCenter
                    x: 16
                    text: "Page 2 – Detail"
                    color: "#ffffff"
                    font.pixelSize: 14
                }

                Rectangle {
                    x: parent.width - 120
                    width: 104
                    height: 32
                    anchors.verticalCenter: parent.verticalCenter
                    color: "#ffffff"
                    radius: 4
                    Text {
                        anchors.centerIn: parent
                        text: "← Back"
                        color: "#2e7d32"
                        font.pixelSize: 12
                    }
                    MouseArea {
                        anchors.fill: parent
                        onClicked: stack.pop()
                    }
                }
            }

            Text {
                anchors.centerIn: parent
                text: "You navigated to Page 2 via StackView!\nClick ← Back to return."
                font.pixelSize: 18
                color: "#1a1a2e"
                horizontalAlignment: Text.AlignHCenter
                wrapMode: Text.WordWrap
            }
        }
    }
}
