import {Group} from "./groups.js"
import {Service} from "./service.js"

export class File extends Service {
    constructor(update) {
        super(update, "Local File (.json)", true)
    }

    fetchRoutine() {
        // const input = document.createElement("input");
        // input.style.display = "none"
        // input.setAttribute("type", "file")
        // input.setAttribute("accept", ".json,application/json")
        // input.dispatchEvent(new MouseEvent("click"))
        // input.addEventListener("change", value => console.log(value))
        return $.ajax({url: "....json", dataType: "json"}).then(res => res.map(Group.fromJSON))
    }

    transferRoutine(transfer) {
        transfer.done()
    }

    transfer(group) {
        const transfers = super.transfer(group)
        let waiting = true
        // set a callback routine when each transfer becomes ready
        transfers.forEach(transfer => transfer.onReady(_ => {
            // when all of them are ready, collect the results into a single file
            // use the "waiting" variable to avoid multiple downloads
            if (waiting && transfers.every(it => it.ready)) {
                waiting = false
                const name = transfers.length === 1 ? `_${transfers[0].name.replaceAll(" ", "_")}` : ""
                const text = JSON.stringify(transfers, null, 2)
                const link = document.createElement("a")
                link.style.display = "none"
                link.setAttribute("href", "data:text/plain;charset=utf-8," + encodeURIComponent(text))
                link.setAttribute("download", "music_transfer" + name + ".json")
                document.body.appendChild(link)
                link.click()
                document.body.removeChild(link)
            }
        }))
        return transfers
    }
}
