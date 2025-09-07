import {Albums, All, Artists, Playlist, Tracks} from "./groups.js"
import {SourceService, TargetService} from "./service.js"

const data = {
    name: "tidal",
    title: "Tidal",
    token: {
        clientID: "CE49NT7wvkwoZ1s3",
        authorizationEndpoint: "https://login.tidal.com/authorize",
        exchangeEndpoint: "https://auth.tidal.com/v1/oauth2/token",
        scope: "collection.read collection.write playlists.read playlists.write user.read"
    }
}

// custom tidal request
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
        data: $.isEmptyObject(data) ? undefined : JSON.stringify(data)
    })
}

function check({done, fail, apply}) {
    // safety check call to user/me
    request("users/me", this.token).done(done).fail(fail).always(apply)
}

function fetch({done, fail, apply}) {
    // get user information and use them to build the various query links
    this.check({
        apply: apply,
        fail: fail,
        done: res => {
            const user = {id: res.data.id, country: res.data.attributes.country, locale: navigator.language}
            // build the routine to fetch favourite artists
            const artistsRoutine = this.fetchRoutine({
                url: "userCollections/" + user.id + "/relationships/artists?countryCode=" + user.country + "&locale=" + user.locale + "&include=artists",
                routine: res => {
                    const info = Object.fromEntries(res.included?.map(it => [it.id, it]) || [])
                    const items = res.data
                        .map(artist => info[artist.id])
                        .filter(artist => artist && artist.id)
                        .map(artist => new Object({
                            tidal: artist.id,
                            name: artist.attributes.name
                        }))
                    return {url: res.links.next, items: items}
                },
                request: request,
                apply: apply
            })
            // build the routine to fetch favourite albums
            const albumsRoutine = this.fetchRoutine({
                url: "userCollections/" + user.id + "/relationships/albums?countryCode=" + user.country + "&locale=" + user.locale + "&include=albums.artists",
                routine: res => {
                    const info = Object.fromEntries(res.included?.map(it => [it.id, it]) || [])
                    const items = res.data
                        .map(album => info[album.id])
                        .filter(album => album && album.id)
                        .map(album => new Object({
                            tidal: album.id,
                            name: album.attributes.title,
                            artists: album.relationships.artists.data.map(artist => info[artist.id]?.attributes?.name).filter(artist => artist),
                            upc: album.attributes.barcodeId
                        }))
                    return {url: res.links.next, items: items}
                },
                request: request,
                apply: apply
            })
            // build the routine to fetch favourite tracks
            const tracksRoutine = this.fetchRoutine({
                url: "userCollections/" + user.id + "/relationships/tracks?countryCode=" + user.country + "&locale=" + user.locale + "&include=tracks.artists",
                routine: res => {
                    const info = Object.fromEntries(res.included?.map(it => [it.id, it]) || [])
                    const items = res.data
                        .map(track => info[track.id])
                        .filter(track => track && track.id)
                        .map(track => new Object({
                            tidal: track.id,
                            name: track.attributes.title,
                            artists: track.relationships.artists.data.map(artist => info[artist.id]?.attributes?.name).filter(artist => artist),
                            isrc: track.attributes.isrc
                        }))
                    return {url: res.links.next, items: items}
                },
                request: request,
                apply: apply
            })
            //build the items routine to fetch playlist items given the playlist id
            const itemsRoutine = playlist => this.fetchRoutine({
                url: "/playlists/" + playlist.id + "/relationships/items?countryCode=" + user.country + "&include=items.artists",
                routine: res => {
                    const info = Object.fromEntries(res.included?.map(it => [it.id, it]) || [])
                    const items = res.data
                        .map(item => info[item.id])
                        .filter(item => item && item.id)
                        .map(item => new Object({
                            tidal: item.id,
                            name: item.attributes.title,
                            artists: item.relationships.artists.data.map(artist => info[artist.id]?.attributes?.name).filter(artist => artist),
                            isrc: item.attributes.isrc
                        }))
                    return {url: res.links.next, items: items}
                },
                request: request,
                apply: apply
            })
            // build the routine to fetch playlists information (using internally the routine to fetch its items)
            const playlistsRoutine = this.fetchRoutine({
                url: "userCollections/" + user.id + "/relationships/playlists?countryCode=" + user.country + "&locale=" + user.locale + "&include=playlists",
                routine: res => {
                    const info = Object.fromEntries(res.included?.map(it => [it.id, it]) || [])
                    const items = res.data.map(playlist => info[playlist.id]).filter(playlist => playlist).map(playlist => new Playlist(
                        itemsRoutine(playlist), {
                            name: playlist.attributes.name,
                            description: playlist.attributes.description,
                            open: playlist.attributes.accessType === "PUBLIC"
                        }
                    ))
                    return {url: res.links.next, items: items}
                },
                request: request,
                apply: apply
            })
            // build the "All" object with already built items and the routine to fetch all the playlists
            const all = new All([
                new Artists(artistsRoutine),
                new Albums(albumsRoutine),
                new Tracks(tracksRoutine)
            ], playlistsRoutine)
            // rune the "done" routine
            done(all)
        }
    })
}


function transfer({transfer, apply}) {
    // start with a safety check by calling the spotify api to get user information
    this.check({
        apply: apply,
        fail: () => transfer.abort(),
        done: res => {
            const user = {id: res.data.id, country: res.data.attributes.country, locale: navigator.language}
            let query
            let push
            // assign the variables depending on the datatype
            switch (transfer.data.type) {
                case "artists":
                    // query by artist name then filter for name matching and return the first result
                    query = artist => request(
                        "searchResults/" + artist.name + "?include=artists&countryCode=" + user.country,
                        this.token
                    ).then(res => res.included.filter(it => it.attributes.name.toLowerCase() === artist.name.toLowerCase()).map(it => it.id).slice(0, 1))
                    push = data => request(
                        "userCollections/" + user.id + "/relationships/artists?countryCode=" + user.country,
                        this.token,
                        {
                            method: "POST",
                            accept: "*/*",
                            contentType: "application/vnd.api+json",
                            data: data.map(it => new Object({id: it.tidal, type: "artists"}))
                        }
                    )
                    break
                case "albums":
                    query = album => request(
                        "albums?countryCode=" + user.country + "&filter[barcodeId]=" + album.upc,
                        this.token
                    ).then(res => res.data.map(it => it.id))
                    push = data => request(
                        "userCollections/" + user.id + "/relationships/albums?countryCode=" + user.country,
                        this.token,
                        {
                            method: "POST",
                            accept: "*/*",
                            contentType: "application/vnd.api+json",
                            data: data.map(it => new Object({id: it.tidal, type: "albums"}))
                        }
                    )
                    break
                case "tracks":
                    // query = track => request(
                    //     "tracks?countryCode=" + user.country + "&filter[isrc]=" + track.isrc,
                    //     this.token
                    // ).then(res => res.data.map(it => it.id))
                    // push = data => request(
                    //     "userCollections/" + user.id + "/relationships/tracks?countryCode=" + user.country,
                    //     this.token,
                    //     {
                    //         method: "POST",
                    //         accept: "*/*",
                    //         contentType: "application/vnd.api+json",
                    //         data: data.map(it => new Object({id: it.tidal, type: "tracks"}))
                    //     }
                    // )
                    // break
                    alert("Transferring favourite tracks is not yet possible on Tidal.\nYou will find your tracks in a new playlist.")
                    // handle favourite tracks using the same strategy of playlists since the APIs do not support this
                    request(
                        "playlists?countryCode=" + user.country,
                        this.token, {
                            method: "POST",
                            accept: "*/*",
                            contentType: "application/vnd.api+json",
                            data: {
                                type: "playlists",
                                attributes: {
                                    name: "Favourite Tracks",
                                    description: "Favourite Tracks Playlist (automatically generated from Music Transfer)",
                                    accessType: "UNLISTED"
                                }
                            }
                        }
                    ).done(playlist => {
                        this.transferRoutine({
                            query: track => request(
                                "tracks?countryCode=" + user.country + "&filter[isrc]=" + track.isrc,
                                this.token
                            ).then(res => res.data.map(it => it.id)),
                            push: data => request(
                                "playlists/" + playlist.data.id + "/relationships/items?countryCode=" + user.country,
                                this.token,
                                {
                                    method: "POST",
                                    accept: "*/*",
                                    contentType: "application/vnd.api+json",
                                    data: data.map(it => new Object({id: it.tidal, type: "tracks"}))
                                }
                            ),
                            limit: 20,
                            transfer: transfer,
                            apply: apply
                        })
                    }).fail(res => {
                        // in case of failure, wait 2 seconds before trying again
                        console.warn("Error during playlist creation, retrying in 2 seconds", res)
                        setTimeout(() => this.transfer({transfer: transfer, apply: apply}), 2000)
                    })
                    return
                case "playlist":
                    // use a different strategy for playlists, i.e.:
                    //   > first post a request to build the playlist using the user id and the playlist data
                    //   > then call the transferRoutine routine to post tracks on the newly created playlist
                    request(
                        "playlists?countryCode=" + user.country,
                        this.token, {
                            method: "POST",
                            accept: "*/*",
                            contentType: "application/vnd.api+json",
                            data: {
                                type: "playlists",
                                attributes: {
                                    name: transfer.data.name,
                                    description: transfer.data.description,
                                    accessType: transfer.data.open ? "PUBLIC" : "UNLISTED"
                                }
                            }
                        }
                    ).done(playlist => {
                        this.transferRoutine({
                            query: track => request(
                                "tracks?countryCode=" + user.country + "&filter[isrc]=" + track.isrc,
                                this.token
                            ).then(res => res.data.map(it => it.id)),
                            push: data => request(
                                "playlists/" + playlist.data.id + "/relationships/items?countryCode=" + user.country,
                                this.token,
                                {
                                    method: "POST",
                                    accept: "*/*",
                                    contentType: "application/vnd.api+json",
                                    data: data.map(it => new Object({id: it.tidal, type: "tracks"}))
                                }
                            ),
                            limit: 20,
                            transfer: transfer,
                            apply: apply
                        })
                    }).fail(res => {
                        // in case of failure, wait between 2000 seconds before trying again
                        console.warn("Error during playlist creation, retrying in 2 seconds", res)
                        setTimeout(() => this.transfer({transfer: transfer, apply: apply}), 2000)
                    })
                    return
                default:
                    console.warn("Unexpected group type " + transfer.data.type)
                    transfer.abort()
                    return
            }
            // call the transferRoutine routine setting the routine with the given variables
            this.transferRoutine({
                query: query,
                push: push,
                limit: 20,
                transfer: transfer,
                apply: apply
            })
        }
    })
}

export const sourceTidal = new SourceService({fetch: fetch, check: check, ...data})

export const targetTidal = new TargetService({transfer: transfer, check: check, ...data})
