const redirect = "https://localhost:63342/music-transfer/index.html"
const alphanumeric = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

function generate(length) {
    return crypto
        .getRandomValues(new Uint8Array(length))
        .reduce((output, value) => output + alphanumeric[value % alphanumeric.length], "")
}

export class Service {
    client_id = null
    authorization_endpoint = null
    exchange_endpoint = null
    scope = null

    // pass angular update routine ($scope.$apply) to update the scope on ajax responses
    constructor(update) {
        if (this.constructor === Service) {
            throw new Error("Cannot instantiate an abstract class")
        }
        this.name = this.constructor.name
        this.update = update
    }

    _set(key, value) {
        localStorage.setItem(key + this.name, value)
    }

    _get(key) {
        return localStorage.getItem(key + this.name)
    }

    _remove(key) {
        return localStorage.removeItem(key + this.name)
    }

    verifier() {
        return this._get("verifier")
    }

    state() {
        return this._get("state")
    }

    token() {
        return this._get("token")
    }

    authorization_url() {
        // build and store random state and code verifier for the payload (saved in the storage)
        const verifier = generate(64)
        const state = generate(16)
        this._set("verifier", verifier)
        this._set("state", state)
        // perform cryptographic operations to get the code challenge from the verifier
        return crypto.subtle
            // hash the built verifier using SHA-256
            .digest('SHA-256', new TextEncoder().encode(verifier))
            // reconvert it to an array and then to a string
            .then(hashed => new Uint8Array(hashed))
            .then(hashed => String.fromCharCode(...hashed))
            // manipulate the hash to obtain the challenge code
            .then(hashed => btoa(hashed)
                .replace(/=/g, '')
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
            )
            // return the authorization link as the base url plus the additional parameters concatenated
            .then(challenge => {
                const url = new URL(this.authorization_endpoint)
                url.search = new URLSearchParams({
                    response_type: "code",
                    redirect_uri: redirect,
                    client_id: this.client_id,
                    scope: this.scope,
                    code_challenge_method: "S256",
                    code_challenge: challenge,
                    state: state
                }).toString()
                return url.toString()
            })
    }

    exchange_token(code) {
        return $.ajax({
            url: this.exchange_endpoint,
            method: "POST",
            data: {
                grant_type: "authorization_code",
                client_id: this.client_id,
                redirect_uri: redirect,
                code_verifier: this.verifier(),
                code: code
            }
        }).then(res => {
            // store the received token
            this._set("token", res.access_token)
            // remove the codes
            this._remove("verifier")
            this._remove("state")
        })
    }

    export() {
    }

    import(data) {
    }
}

// dummy service to handle selections
export class Dummy extends Service {
    constructor(update) {
        super(update)
        this.disabled = true
        this.name = "Select an option..."
    }

    _set(key, value) {
    }
}

