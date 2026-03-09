import QtQuick 2.15
import QtQuick.Controls 2.15

Rectangle {
    id: root
    width: 720
    height: 520
    color: "#F7F3E9"

    property var slides: [
        {
            "title": "Un ordenador que te escucha",
            "body": "AgenOS nace para reducir la dependencia del escritorio tradicional y preparar una experiencia guiada por voz."
        },
        {
            "title": "Base Debian, enfoque estable",
            "body": "La primera version prioriza una base mantenible: instalador grafico, paquetes conocidos y una imagen reproducible."
        },
        {
            "title": "Preparado para la siguiente fase",
            "body": "La ISO ya deja espacio para UI kiosk, agente local, tools auditables y pipeline de voz offline-first."
        }
    ]

    property int slideIndex: 0

    Timer {
        interval: 4500
        repeat: true
        running: true
        onTriggered: root.slideIndex = (root.slideIndex + 1) % root.slides.length
    }

    Rectangle {
        anchors.fill: parent
        gradient: Gradient {
            GradientStop { position: 0.0; color: "#F7F3E9" }
            GradientStop { position: 1.0; color: "#E9E0C9" }
        }
    }

    Column {
        anchors.fill: parent
        anchors.margins: 48
        spacing: 24

        Rectangle {
            width: 76
            height: 76
            radius: 20
            color: "#12343B"

            Text {
                anchors.centerIn: parent
                text: "A"
                color: "#E6B655"
                font.pixelSize: 38
                font.bold: true
            }
        }

        Text {
            text: root.slides[root.slideIndex].title
            wrapMode: Text.Wrap
            color: "#12343B"
            font.pixelSize: 28
            font.bold: true
        }

        Text {
            text: root.slides[root.slideIndex].body
            wrapMode: Text.Wrap
            color: "#2B454A"
            font.pixelSize: 18
            lineHeight: 1.25
        }

        Rectangle {
            width: parent.width
            height: 1
            color: "#D7CCB2"
        }

        Repeater {
            model: [
                "Instalacion guiada con Calamares",
                "Sesion live preparada para accesibilidad",
                "Base para Chromium + Cage + PipeWire"
            ]

            delegate: Row {
                spacing: 14

                Rectangle {
                    width: 10
                    height: 10
                    radius: 5
                    color: "#E6B655"
                    anchors.verticalCenter: parent.verticalCenter
                }

                Text {
                    text: modelData
                    color: "#12343B"
                    font.pixelSize: 16
                }
            }
        }
    }
}
