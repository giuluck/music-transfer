import {Service} from "./service.js"

export class Text extends Service {
    token() {
        return true
    }

    authorize() {
    }

    exchange(code) {
    }

    fetch() {
        throw Error("Not implemented")
    }

    transfer(group) {
        const text = JSON.stringify(group.toJson(), null, 4)
        const link = document.createElement("a")
        link.style.display = "none"
        link.setAttribute("href", "data:text/plain;charset=utf-8," + encodeURIComponent(text))
        link.setAttribute("download", group.name.replaceAll(" ", "_") + ".json")
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
    }
}
