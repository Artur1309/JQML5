import QtQuick 2.15

Item {
    id: root
    width: 480
    height: 600

    // -----------------------------------------------------------------------
    // Model
    // -----------------------------------------------------------------------
    ListModel {
        id: contactsModel
        ListElement { name: "Alice";  city: "Berlin";    age: 30 }
        ListElement { name: "Bob";    city: "Paris";     age: 25 }
        ListElement { name: "Carol";  city: "London";    age: 35 }
        ListElement { name: "Dave";   city: "Tokyo";     age: 28 }
        ListElement { name: "Eve";    city: "New York";  age: 22 }
        ListElement { name: "Frank";  city: "Sydney";    age: 40 }
        ListElement { name: "Grace";  city: "Moscow";    age: 33 }
        ListElement { name: "Heidi";  city: "Rome";      age: 27 }
        ListElement { name: "Ivan";   city: "Seoul";     age: 31 }
        ListElement { name: "Judy";   city: "Mumbai";    age: 29 }
    }

    // -----------------------------------------------------------------------
    // Title bar
    // -----------------------------------------------------------------------
    Rectangle {
        id: titleBar
        width: root.width
        height: 50
        color: "#3f51b5"

        Item {
            anchors.fill: titleBar
            Item {
                x: 16
                y: 15
                width: titleBar.width - 32
                height: 20
            }
        }
    }

    // -----------------------------------------------------------------------
    // ListView
    // -----------------------------------------------------------------------
    ListView {
        id: listView
        x: 0
        y: 60
        width: root.width
        height: root.height - 120

        model: contactsModel

        delegate: Rectangle {
            width: listView.width
            height: 56
            color: index % 2 === 0 ? "#ffffff" : "#f5f5f5"
            borderColor: "#e0e0e0"
            borderWidth: 1

            Rectangle {
                x: 12
                y: 8
                width: 40
                height: 40
                color: "#3f51b5"
                radius: 20
            }

            Item {
                x: 64
                y: 10
                width: listView.width - 76
                height: 36
            }

            MouseArea {
                anchors.fill: parent
                onClicked: {
                    contactsModel.remove(index)
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Bottom action bar
    // -----------------------------------------------------------------------
    Rectangle {
        id: actionBar
        x: 0
        y: root.height - 60
        width: root.width
        height: 60
        color: "#fafafa"
        borderColor: "#e0e0e0"
        borderWidth: 1

        // "Add" button
        Rectangle {
            id: addButton
            x: 16
            y: 10
            width: 120
            height: 40
            color: "#4caf50"
            radius: 4

            MouseArea {
                anchors.fill: parent
                onClicked: {
                    contactsModel.append({
                        name: "New Contact",
                        city: "Unknown",
                        age: 0
                    })
                }
            }
        }

        // "Clear" button
        Rectangle {
            id: clearButton
            x: 152
            y: 10
            width: 120
            height: 40
            color: "#f44336"
            radius: 4

            MouseArea {
                anchors.fill: parent
                onClicked: {
                    contactsModel.clear()
                }
            }
        }

        // "Reset" button
        Rectangle {
            id: resetButton
            x: 288
            y: 10
            width: 120
            height: 40
            color: "#ff9800"
            radius: 4

            MouseArea {
                anchors.fill: parent
                onClicked: {
                    contactsModel.clear()
                    contactsModel.append({ name: "Alice", city: "Berlin", age: 30 })
                    contactsModel.append({ name: "Bob",   city: "Paris",  age: 25 })
                    contactsModel.append({ name: "Carol", city: "London", age: 35 })
                }
            }
        }
    }
}
