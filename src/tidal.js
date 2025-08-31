import {Albums, Artists, Playlist} from "./groups.js"
import {SourceService, TargetService} from "./service.js";

const country = navigator.language.split('-')[1]
const locale = navigator.language

const data = {
    name: "Tidal",
    title: "Tidal",
    token: {
        clientID: "CE49NT7wvkwoZ1s3",
        authorizationEndpoint: "https://login.tidal.com/authorize",
        exchangeEndpoint: "https://auth.tidal.com/v1/oauth2/token",
        scope: "collection.read collection.write playlists.read playlists.write"
    }
}

function request(url, token, {
    method = "GET",
    accept = "application/vnd.api+json",
    contentType = "application/x-www-form-urlencoded; charset=UTF-8",
    ...data
} = {}) {
    return $.ajax({
        url: `https://openapi.tidal.com/v2/${url}`,
        method: method,
        contentType: contentType,
        headers: {accept: accept, Authorization: "Bearer " + token},
        data: data
    })
}

function fetch({done, fail, apply}) {
    // fetch user information to get its identifier
    request("users/me", this.token)
        // use the retrieved user id to query the user collection
        .then(res => request(
            "userCollections/" + res.data.id +
            "?locale=" + locale +
            "&countryCode=" + country +
            "&include=playlists" +
            "&include=artists" +
            "&include=albums" +
            "&include=albums.artists",
            this.token
        ))
        // map the user collection into sets of items
        .then(res => {
            // build a dictionary of included information
            const info = Object.fromEntries(res.included.map(it => [it.id, it]))
            // recursive fetch routine for delayed tracks fetching in playlists
            const fetch = (url, attempt, group) => {
                // if the url is undefined, the fetching process is done
                if (!url) {
                    group.done()
                    apply()
                    return
                }
                // otherwise, send a request to the url
                request(url + "&include=items.artists", this.token)
                    .done(res => {
                        // build a dictionary of included information
                        const info = Object.fromEntries(res.included.map(it => [it.id, it]))
                        // recursively call the routine with the next urò
                        fetch(res.links.next, 1, group)
                        // add each retrieved track to the playlist
                        res.data.forEach(it => {
                            const track = info[it.id]
                            group.add({
                                name: track.attributes.title,
                                artists: track.relationships.artists.data.map(artist => info[artist.id].attributes.name),
                                isrc: track.attributes.isrc
                            })
                        })
                        // update the scope
                        apply()
                    })
                    // in case of failure, try to fetch the same url after waiting an exponentially higher time
                    .fail(_ => setTimeout(
                        () => fetch(url, attempt + 1, group),
                        10 ** attempt
                    ))
            }
            // build the playlists
            const playlists = res.data.relationships.playlists.data
                .map(playlist => info[playlist.id])
                .map(playlist => new Playlist({
                    name: playlist.attributes.name,
                    description: playlist.attributes.description,
                    open: playlist.attributes.accessType === "PUBLIC",
                    length: playlist.attributes.numberOfItems,
                    routine: group => fetch(playlist.relationships.items.links.self, 1, group)
                }))
            // build the favourite albums group
            const albums = new Albums({
                items: res.data.relationships.albums.data.map(it => {
                    const album = info[it.id]
                    return {
                        name: album.attributes.title,
                        artists: album.relationships.artists.data.map(artist => info[artist.id].attributes.name)
                    }
                })
            })
            // build the favourite artists groups
            const artists = new Artists({
                items: res.data.relationships.artists.data.map(it => {
                    const artist = info[it.id]
                    return {name: artist.attributes.name}
                })
            })
            return [artists, albums, ...playlists]
        })
        // call the conclusive routines
        .done(done)
        .fail(fail)
        .always(apply)
}

function transfer({transfer, apply}) {
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

export const sourceTidal = new SourceService({fetch: fetch, ...data})

export const targetTidal = new TargetService({transfer: transfer, ...data})
