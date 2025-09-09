import {Albums, All, Artists, Playlist, Tracks} from "./groups.js"
import {Service} from "./service.js"


export class Tidal extends Service {
    constructor(apply) {
        super(apply, "Tidal", undefined, {
            clientID: "CE49NT7wvkwoZ1s3",
            authorizationEndpoint: "https://login.tidal.com/authorize",
            exchangeEndpoint: "https://auth.tidal.com/v1/oauth2/token",
            scope: "collection.read collection.write playlists.read playlists.write user.read"
        })
    }

    _request(url, {method = "GET", message, accept, contentType, ...data} = {}) {
        // set default values for accept and contentType in case they are undefined
        return super._request(url, {
                method: method,
                message: message,
                accept: accept || "application/vnd.api+json",
                contentType: contentType || "application/x-www-form-urlencoded; charset=UTF-8",
                ...data
            }
        )
    }

    _fetch() {
        // get user information and use them to build the various query links
        return this._request("https://openapi.tidal.com/v2/users/me").then(user => {
            user = {id: user.data.id, country: user.data.attributes.country, locale: navigator.language}
            // build the routine to fetch favourite artists
            const artistsRoutine = this._fetchRoutine({
                url: "https://openapi.tidal.com/v2/userCollections/" + user.id + "/relationships/artists?countryCode=" + user.country + "&locale=" + user.locale + "&include=artists",
                routine: res => {
                    const info = Object.fromEntries(res.included?.map(it => [it.id, it]) || [])
                    const items = res.data
                        .map(artist => info[artist.id])
                        .filter(artist => artist && artist.id)
                        .map(artist => new Object({
                            tidal: {id: artist.id, type: "artists"},
                            name: artist.attributes.name
                        }))
                    return {
                        url: res.links.next ? "https://openapi.tidal.com/v2" + res.links.next : undefined,
                        items: items
                    }
                }
            })
            // build the routine to fetch favourite albums
            const albumsRoutine = this._fetchRoutine({
                url: "https://openapi.tidal.com/v2/userCollections/" + user.id + "/relationships/albums?countryCode=" + user.country + "&locale=" + user.locale + "&include=albums.artists",
                routine: res => {
                    const info = Object.fromEntries(res.included?.map(it => [it.id, it]) || [])
                    const items = res.data
                        .map(album => info[album.id])
                        .filter(album => album && album.id)
                        .map(album => new Object({
                            tidal: {id: album.id, type: "albums"},
                            name: album.attributes.title,
                            artists: album.relationships.artists.data.map(artist => info[artist.id]?.attributes?.name).filter(artist => artist),
                            upc: album.attributes.barcodeId
                        }))
                    return {
                        url: res.links.next ? "https://openapi.tidal.com/v2" + res.links.next : undefined,
                        items: items
                    }
                }
            })
            // build the routine to fetch favourite tracks
            const tracksRoutine = this._fetchRoutine({
                url: "https://openapi.tidal.com/v2/userCollections/" + user.id + "/relationships/tracks?countryCode=" + user.country + "&locale=" + user.locale + "&include=tracks.artists",
                routine: res => {
                    const info = Object.fromEntries(res.included?.map(it => [it.id, it]) || [])
                    const items = res.data
                        .map(track => info[track.id])
                        .filter(track => track && track.id)
                        .map(track => new Object({
                            tidal: {id: track.id, type: "tracks"},
                            name: track.attributes.title,
                            artists: track.relationships.artists.data.map(artist => info[artist.id]?.attributes?.name).filter(artist => artist),
                            isrc: track.attributes.isrc
                        }))
                    return {
                        url: res.links.next ? "https://openapi.tidal.com/v2" + res.links.next : undefined,
                        items: items
                    }
                }
            })
            //build the items routine to fetch playlist items given the playlist id
            const itemsRoutine = playlist => this._fetchRoutine({
                url: "https://openapi.tidal.com/v2/playlists/" + playlist.id + "/relationships/items?countryCode=" + user.country + "&include=items.artists",
                routine: res => {
                    const info = Object.fromEntries(res.included?.map(it => [it.id, it]) || [])
                    const items = res.data
                        .map(item => info[item.id])
                        .filter(item => item && item.id)
                        .map(item => new Object({
                            tidal: {id: item.id, type: "tracks"},
                            name: item.attributes.title,
                            artists: item.relationships.artists.data.map(artist => info[artist.id]?.attributes?.name).filter(artist => artist),
                            isrc: item.attributes.isrc
                        }))
                    return {
                        url: res.links.next ? "https://openapi.tidal.com/v2" + res.links.next : undefined,
                        items: items
                    }
                }
            })
            // build the routine to fetch playlists information (using internally the routine to fetch its items)
            const playlistsRoutine = this._fetchRoutine({
                url: "https://openapi.tidal.com/v2/userCollections/" + user.id + "/relationships/playlists?countryCode=" + user.country + "&locale=" + user.locale + "&include=playlists",
                routine: res => {
                    const info = Object.fromEntries(res.included?.map(it => [it.id, it]) || [])
                    const items = res.data.map(playlist => info[playlist.id]).filter(playlist => playlist).map(playlist => new Playlist(
                        itemsRoutine(playlist), {
                            name: playlist.attributes.name,
                            description: playlist.attributes.description,
                            open: playlist.attributes.accessType === "PUBLIC"
                        }
                    ))
                    return {
                        url: res.links.next ? "https://openapi.tidal.com/v2" + res.links.next : undefined,
                        items: items
                    }
                }
            })
            // build the "All" object with already built items and the routine to fetch all the playlists
            return new All([
                new Artists(artistsRoutine),
                new Albums(albumsRoutine),
                new Tracks(tracksRoutine)
            ], playlistsRoutine)
        })
    }


    _transfer(transfer) {
        // get user information and use them to build the various query links
        this._request("https://openapi.tidal.com/v2/users/me").then(res => {
            const user = {id: res.data.id, country: res.data.attributes.country, locale: navigator.language}
            let process
            let query
            let push
            // assign the variables depending on the datatype
            switch (transfer.data.type) {
                case "artists":
                    // query by artist name then filter for name matching and return the first result
                    process = (res, artist) => res.included
                        .filter(it => it.attributes.name.toLowerCase() === artist.name.toLowerCase())
                        .map(it => new Object({id: it.id, type: "artists"}))
                    query = artist => "https://openapi.tidal.com/v2/searchResults/" + artist.name + "?include=artists&countryCode=" + user.country
                    push = "https://openapi.tidal.com/v2/userCollections/" + user.id + "/relationships/artists?countryCode=" + user.country
                    break
                case "albums":
                    process = res => res.data.map(it => new Object({id: it.id, type: "albums"}))
                    query = album => "https://openapi.tidal.com/v2/albums?countryCode=" + user.country + "&filter[barcodeId]=" + album.upc
                    push = "https://openapi.tidal.com/v2/userCollections/" + user.id + "/relationships/albums?countryCode=" + user.country
                    break
                case "tracks":
                    // process = res => res.data.map(it => new Object({id: it.id, type: "tracks"}))
                    // query = track => "https://openapi.tidal.com/v2/tracks?countryCode=" + user.country + "&filter[isrc]=" + track.isrc
                    // push = "https://openapi.tidal.com/v2/userCollections/" + user.id + "/relationships/tracks?countryCode=" + user.country
                    // break
                    alert("Transferring favourite tracks is not yet possible on Tidal.\nYou will find your tracks in a new playlist.")
                    // handle favourite tracks using the same strategy of playlists since the APIs do not support this
                    this._request("https://openapi.tidal.com/v2/playlists?countryCode=" + user.country, {
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
                    }).done(playlist => {
                        this._transferRoutine({
                            process: res => res.data.map(it => new Object({id: it.id, type: "tracks"})),
                            query: track => "https://openapi.tidal.com/v2/tracks?countryCode=" + user.country + "&filter[isrc]=" + track.isrc,
                            push: batch => new Object({
                                url: "https://openapi.tidal.com/v2/playlists/" + playlist.data.id + "/relationships/items?countryCode=" + user.country,
                                method: "POST",
                                accept: "*/*",
                                contentType: "application/vnd.api+json",
                                data: batch
                            }),
                            limit: 20,
                            transfer: transfer
                        })
                    }).catch(() => transfer.abort())
                    return
                case "playlist":
                    // use a different strategy for playlists, i.e.:
                    //   > first post a request to build the playlist using the user id and the playlist data
                    //   > then call the _transferRoutine routine to post tracks on the newly created playlist
                    this._request("https://openapi.tidal.com/v2/playlists?countryCode=" + user.country, {
                        method: "POST",
                        message: "Error during playlist creation",
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
                    }).then(playlist => {
                        this._transferRoutine({
                            process: res => res.data.map(it => new Object({id: it.id, type: "tracks"})),
                            query: track => "https://openapi.tidal.com/v2/tracks?countryCode=" + user.country + "&filter[isrc]=" + track.isrc,
                            push: batch => new Object({
                                url: "https://openapi.tidal.com/v2/playlists/" + playlist.data.id + "/relationships/items?countryCode=" + user.country,
                                method: "POST",
                                accept: "*/*",
                                contentType: "application/vnd.api+json",
                                data: batch
                            }),
                            limit: 20,
                            transfer: transfer
                        })
                    }).catch(() => transfer.abort())
                    return
                default:
                    console.warn("Unexpected group type " + transfer.data.type)
                    transfer.abort()
                    return
            }
            // call the _transferRoutine routine setting the routine with the given variables
            this._transferRoutine({
                process: process,
                query: query,
                push: batch => new Object({
                    url: push,
                    method: "POST",
                    accept: "*/*",
                    contentType: "application/vnd.api+json",
                    data: batch
                }),
                limit: 20,
                transfer: transfer
            })
        }).catch(() => transfer.abort())
    }
}
