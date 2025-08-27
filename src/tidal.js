import {Album, Artist, Group, Playlist, Track} from "./items.js"
import {Service} from "./service.js"

const country = navigator.language.split('-')[1]
const locale = navigator.language

export class Tidal extends Service {
    client_id = "CE49NT7wvkwoZ1s3"
    authorization_endpoint = "https://login.tidal.com/authorize"
    exchange_endpoint = "https://auth.tidal.com/v1/oauth2/token"
    scope = "collection.read collection.write playlists.read playlists.write"

    // custom request function wrapping the ajax request with default parameters
    request = (url, {
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

    fetch_tracks = (url, playlist, attempt = 1) => {
        // if the url is undefined, stop the routine
        if (!url) return
        // otherwise, send a request to the given url
        this.request(url + "&include=items.artists")
            // if the request is successful, perform the operations on the yielded result
            .done(res => {
                // build a dictionary of included information
                const info = Object.fromEntries(res.included.map(item => [item.id, item]))
                // send a request to the next url
                this.fetch_tracks(res.links.next, playlist)
                // build tracks and add them to the playlist
                res.data
                    .map(track => info[track.id])
                    .map(track => new Track({
                        name: track.attributes.title,
                        artists: track.relationships.artists.data?.map(artist => info[artist.id].attributes.name),
                        isrc: track.attributes.isrc
                    }))
                    .forEach(track => playlist.add(track))
                // update the angular scope to reflect changes
                this.update()
            })
            // otherwise, try to call the request again after an exponential waiting time
            .fail(_ => new Promise(handler => setTimeout(handler, 10 ** attempt))
                .then(_ => this.fetch_tracks(url, playlist, attempt + 1))
            )
    }

    fetch() {
        // fetch user information to get its identifier
        return this.request("users/me")
            // use the retrieved user id to query the user collection
            .then(res => this.request(
                "userCollections/" + res.data.id +
                "?locale=" + locale +
                "&countryCode=" + country +
                "&include=playlists" +
                "&include=artists" +
                "&include=albums" +
                "&include=albums.artists"
            ))
            // map the user collection into sets of items
            .then(res => {
                // build a dictionary of included information
                const info = Object.fromEntries(res.included.map(item => [item.id, item]))
                // build the favourite artists set
                const artists = res.data.relationships.artists.data
                    .map(artist => info[artist.id])
                    .map(artist => new Artist({
                        name: artist.attributes.name
                    }))
                // build the favourite albums set
                const albums = res.data.relationships.albums.data
                    .map(album => info[album.id])
                    .map(album => new Album({
                        name: album.attributes.title,
                        artists: album.relationships.artists.data?.map(artist => info[artist.id].attributes.name)
                    }))
                // build the playlists
                const playlists = res.data.relationships.playlists.data
                    .map(playlist => info[playlist.id])
                    .map(playlist => new Playlist({
                        name: playlist.attributes.name,
                        description: playlist.attributes.description,
                        open: playlist.attributes.accessType === "PUBLIC",
                        size: playlist.attributes.numberOfItems,
                        fetch: object => this.fetch_tracks(playlist.relationships.items.links.self, object)
                    }))
                // return artists and albums as group objects
                return [
                    new Group({name: "Favourite Artists", kind: "artists", items: artists}),
                    new Group({name: "Favourite Albums", kind: "albums", items: albums}),
                    ...playlists
                ]
            })
    }

    transfer(group) {
        // for (let i = 0; i < playlists.length; i++) {
        //     // iterate over all the playlists
        //     const playlist = playlists[i]
        //     // map each track to their respective id
        //     const tracks = playlist.tracks.map(track => this
        //         .request(`tracks?countryCode=${country}&filter%5Bisrc%5D=${track.isrc}`)
        //         .then(res => Object({id: res.data[0].id, type: "tracks"}))
        //     )
        //     // build the playlist with the obtained items
        //     const playlist_id = this.request(
        //         `playlists?countryCode=${country}`,
        //         {
        //             headers: {"Content-Type": "application/vnd.api+json"},
        //             method: "POST",
        //             data: {
        //                 type: "playlists",
        //                 attributes: {
        //                     name: playlist.name,
        //                     description: playlist.description,
        //                     accessType: playlist.public ? "PUBLIC" : "PRIVATE"
        //                 }
        //             }
        //         }
        //     ).then(res => res.data.id)
        //     // use the retrieved playlist id to add all the tracks
        //     this.request(
        //         `playlists/${playlist_id}/relationships/items?countryCode=${country}`,
        //         {
        //             method: "POST",
        //             headers: {accept: "*/*", "Content-Type": "application/vnd.api+json"},
        //             data: tracks
        //         }
        //     )
        // }
    }
}