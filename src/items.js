class Item {

    // pass angular update routine ($scope.$apply) to update the scope on ajax responses
    constructor(update, {id, name, artwork}) {
        if (this.constructor === Item) {
            throw new Error("Cannot instantiate an abstract class")
        }
        this.id = id
        this.name = name
        this.artwork = undefined
        this.selected = true
        this.update = update
        artwork.done(res => {
            this.artwork = res
            this.update()
        })
    }

    toString() {
        return this.name
    }
}

export class Artist extends Item {
}

export class Album extends Item {
    constructor(update, {id, name, artists, artwork}) {
        super(update, {id, name, artwork})
        this.artists = artists
    }
}

export class Playlist extends Item {
    constructor(update, {id, name, description, open, size, items, artwork}) {
        super(update, {id, name, artwork})
        this.description = description
        this.open = open
        this.size = size
        this.items = items
    }
}