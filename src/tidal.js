import {Album, Artist, Playlist} from "./items.js"
import {Service} from "./service.js"

const country = navigator.language.split('-')[1]
const locale = navigator.language

export class Tidal extends Service {
    client_id = "CE49NT7wvkwoZ1s3"
    authorization_endpoint = "https://login.tidal.com/authorize"
    exchange_endpoint = "https://auth.tidal.com/v1/oauth2/token"
    scope = "collection.read collection.write playlists.read playlists.write"

    response = (url, {
        method = "GET",
        accept = "application/vnd.api+json",
        content_type = "application/x-www-form-urlencoded; charset=UTF-8",
        ...data
    } = {}) => $.ajax({
        url: `https://openapi.tidal.com/v2/${url}`,
        method: method,
        contentType: content_type,
        headers: {accept: accept, Authorization: "Bearer " + this.token()},
        data: data
    })

    export() {
        // fetch user information to get its identifier
        return this.response("users/me")
            .then(res => res.data.id)
            .then(id => this.response(
                "userCollections/" + id +
                "?locale=" + locale +
                "&countryCode=" + country +
                "&include=playlists" +
                "&include=albums" +
                "&include=artists"
            ))
            .then(res => res.included)
            .then(items => Object.groupBy(items, item => item.type))
            .then(res => Object({
                playlists: res.playlists.map(item => new Playlist(this.update, {
                    id: item.id,
                    name: item.attributes.name,
                    description: item.attributes.description,
                    open: item.attributes.accessType === "PUBLIC",
                    size: item.attributes.numberOfItems,
                    items: item.relationships.items.links.self,
                    artwork: this.response(item.relationships.coverArt.links.self + "&include=coverArt")
                        .then(res => res.included ? res.included[0].attributes.files[0].href : undefined)
                })),
                albums: res.albums.map(item => new Album(this.update, {
                    id: item.id,
                    name: item.attributes.title,
                    artists: item.relationships.artists.links.self,
                    artwork: this.response(item.relationships.coverArt.links.self + "&include=coverArt")
                        .then(res => res.included ? res.included[0].attributes.files[0].href : undefined)
                })),
                artists: res.artists.map(item => new Artist(this.update, {
                    id: item.id,
                    name: item.attributes.name,
                    artwork: this.response(item.relationships.profileArt.links.self + "&include=profileArt")
                        .then(res => res.included ? res.included[0].attributes.files[0].href : undefined)
                }))
            }))

        // .then(res => {
        //     return playlists.map(playlist => this.response(
        //         `playlists?countryCode=${country}&filter%5Br.owners.id%5D=${id}`,
        //     )).then(attributes => new Object({
        //         name: attributes.name,
        //         description: attributes.description,
        //         public: attributes.accessType === "PUBLIC",
        //     }))
        // })
    }

    import(data) {
        for (let i = 0; i < playlists.length; i++) {
            // iterate over all the playlists
            const playlist = playlists[i]
            // map each track to their respective id
            const tracks = playlist.tracks.map(track => this
                .response(`tracks?countryCode=${country}&filter%5Bisrc%5D=${track.isrc}`)
                .then(res => Object({id: res.data[0].id, type: "tracks"}))
            )
            // build the playlist with the obtained items
            const playlist_id = this.response(
                `playlists?countryCode=${country}`,
                {
                    headers: {"Content-Type": "application/vnd.api+json"},
                    method: "POST",
                    data: {
                        type: "playlists",
                        attributes: {
                            name: playlist.name,
                            description: playlist.description,
                            accessType: playlist.public ? "PUBLIC" : "PRIVATE"
                        }
                    }
                }
            ).then(res => res.data.id)
            // use the retrieved playlist id to add all the tracks
            this.response(
                `playlists/${playlist_id}/relationships/items?countryCode=${country}`,
                {
                    method: "POST",
                    headers: {accept: "*/*", "Content-Type": "application/vnd.api+json"},
                    data: tracks
                }
            )
        }
    }
}