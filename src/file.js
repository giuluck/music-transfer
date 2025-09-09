import {Service} from "./service.js"
import {All, Group} from "./groups.js"

export class File extends Service {
    constructor(apply) {
        super(apply, "Local File (.json)")
        const file = sessionStorage.getItem("fileToken")
        this.sourceTitle = file ? file : this.sourceTitle
    }

    select(source) {
        super.select(source)
        // in case of target selection, set a dummy token to avoid login since no file selection is needed
        this.token = source ? undefined : "dummy"
    }

    // when deselected, reset the token as well so that selecting it again will open up another modal window
    deselect() {
        super.deselect()
        this.fetched = false
        this.token = undefined
        this.sourceTitle = "Local File (.json)"
        sessionStorage.removeItem("fileToken")
        sessionStorage.removeItem("fileContent")
    }

    login() {
        const deferred = $.Deferred()
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
            // if the reading succeeded, update the token and the cache, then resolve the deferred
            reader.onload = () => {
                this.token = file.name
                this.sourceTitle = file.name
                sessionStorage.setItem("fileToken", file.name)
                sessionStorage.setItem("fileContent", reader.result.toString())
                deferred.resolve()
            }
            // if the reading fails, reject the deferred
            reader.onerror = _ => deferred.reject(reader.error)
        })
        return deferred.promise()
    }

    _fetch() {
        // create a jQuery custom deferred and try to read the content of the file from the cache
        const deferred = $.Deferred()
        try {
            // if everything goes well, resolve the deferred assigning the parsed groups as inputs
            const content = sessionStorage.getItem("fileContent")
            const groups = JSON.parse(content).map(Group.fromJSON)
            deferred.resolve(new All(groups))
        } catch (exception) {
            // otherwise, reset the cache and reject the deferred
            this.deselect()
            deferred.reject(exception)
        }
        return deferred.promise()
    }

    _transfer(transfer) {
        transfer.increment(transfer.items.length)
        transfer.complete()
    }

    transfer(group) {
        super.transfer(group)
        // when all the transfer promises have been resolved, join the results into a single file
        $.when(...this.transfers.map(it => it.deferred)).then(() => {
            const name = this.transfers.length === 1 ? `_${this.transfers[0].name.replaceAll(" ", "_")}` : ""
            const text = JSON.stringify(this.transfers.map(it => it.toJSON()), null, 2)
            const link = document.createElement("a")
            link.style.display = "none"
            link.setAttribute("href", "data:text/plain;charset=utf-8," + encodeURIComponent(text))
            link.setAttribute("download", "music_transfer" + name + ".json")
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
        })
    }
}
