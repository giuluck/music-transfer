import {SourceService, TargetService} from "./service.js"
import {Group} from "./groups.js";

const data = {
    name: "File",
    title: "Local File (.json)"
}

function transfer({transfer}) {
    transfer.increment(transfer.length)
    transfer.done()
    if (this.finished) {
        const name = this.transfers.length === 1 ? `_${transfer.name.replaceAll(" ", "_")}` : ""
        const text = JSON.stringify(this.transfers.map(it => it.toJSON()), null, 2)
        const link = document.createElement("a")
        link.style.display = "none"
        link.setAttribute("href", "data:text/plain;charset=utf-8," + encodeURIComponent(text))
        link.setAttribute("download", "music_transfer" + name + ".json")
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
    }
}

function fetch({done, fail}) {
    // try to read the content of the file from the cache
    try {
        // if everything goes well, run the "done" routine using the parsed groups as inputs
        const content = sessionStorage.getItem("contentFile")
        const groups = JSON.parse(content).map(Group.fromJSON)
        done(groups)
    } catch (exception) {
        // otherwise, clear the cache and run the "fail" routine
        this.clear()
        fail(exception)
    }
}

class SourceFile extends SourceService {
    constructor({name, title, fetch}) {
        const file = sessionStorage.getItem("tokenFile")
        super({
            name: name,
            title: file ? file : title,
            token: () => sessionStorage.getItem("tokenFile"),
            fetch: fetch
        })
    }

    // when deselected, clear the cache so that selecting it again will open up another modal window
    deselect() {
        super.deselect()
        this.clear()
    }

    clear() {
        this.title = "Local File (.json)"
        sessionStorage.removeItem("tokenFile")
        sessionStorage.removeItem("contentFile")
    }

    login({done = () => void 0, fail = () => void 0, apply = () => void 0}) {
        // otherwise, build an input element to raise a modal window for file selection
        const input = document.createElement("input")
        input.style.display = "none"
        input.setAttribute("type", "file")
        input.setAttribute("accept", ".json;application/json")
        input.dispatchEvent(new MouseEvent("click"))
        input.addEventListener("change", _ => {
            // when the element is selected, retrieve the file and read it
            const file = input.files[0]
            const reader = new FileReader()
            reader.readAsText(file, "UTF-8")
            reader.onload = () => {
                // if the reading succeeded, update the token and the cache, then run the "done" routine
                this.title = file.name
                sessionStorage.setItem("tokenFile", file.name)
                sessionStorage.setItem("contentFile", reader.result.toString())
                done()
                apply()
            }
            reader.onerror = _ => {
                // if the reading fails, run the "fail" routine
                fail(reader.error)
                apply()
            }
        })
    }
}

export const sourceFile = new SourceFile({fetch: fetch, ...data})

export const targetFile = new TargetService({token: () => true, transfer: transfer, ...data})
