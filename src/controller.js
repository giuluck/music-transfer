import {Dummy} from "./service.js"
import {Spotify} from "./spotify.js"
import {Tidal} from "./tidal.js"

angular.module("module", ["ngSanitize"]).controller("controller", function ($scope) {
    // set list of available services
    $scope.services = {
        null: new Dummy(() => $scope.$apply()),
        Tidal: new Tidal(() => $scope.$apply()),
        Spotify: new Spotify(() => $scope.$apply())
    }

    // handle choices
    $scope.choices = {
        source: $scope.services[localStorage.getItem("source")],
        target: $scope.services[localStorage.getItem("target")],
        transfer: undefined
    }

    // handle requests failure and success
    $scope.error = false
    $scope.failure = (message, data) => {
        console.warn(message, data)
        localStorage.removeItem("waiting")
        $scope.error = true
        $scope.$apply()
    }
    $scope.success = (role, service) => {
        localStorage.setItem(role, service)
        localStorage.removeItem("waiting")
        location.search = ""
    }

    // if an authentication code is returned, check whether a response is being waited (otherwise, clean the search)
    const params = new URLSearchParams(location.search)
    const code = params.get("code")
    if (code) {
        // check that:
        //   - a service is waiting for the returned code
        //   - the yielded state is correct and run the request for the token
        // if anything goes wrong, call the warning function with custom messages and data
        const waiting = localStorage.getItem("waiting")
        if (waiting) {
            const [role, name] = waiting.split(" ")
            const service = $scope.services[name]
            if (params.get("state") === service.state()) {
                service.exchange_token(code)
                    .done(_ => $scope.success(role, name))
                    .fail(res => $scope.failure("Error after token exchange request", res))
            } else {
                $scope.failure("Wrong state yielded by the server", {
                    expected: service.state(),
                    obtained: params.get("state")
                })
            }
        } else {
            console.warn("Code received, but no service is waiting for it")
        }
    }

    // if both the source and the target have been authorized with a token, proceed with the export
    if ($scope.choices.source.token() && $scope.choices.target.token()) {
        $scope.choices.source.export()
            .done(res => {
                $scope.choices.transfer = res
                $scope.$apply()
            })
            .fail(res => $scope.failure("Error after source export request", res))
    }

    // authorization handler for options
    $scope.authorize = role => {
        // retrieve the current service
        const service = $scope.choices[role]
        // if a token is already available, call the success routine
        // otherwise store the waiting response flag and redirect to the authorization url
        if (service.token()) {
            $scope.success(role, service.name)
        } else {
            localStorage.setItem("waiting", role + " " + service.name)
            service.authorization_url().then(url => location.href = url)
        }
    }

    // selection handler for batch operations
    $scope.selection = (key, selected) => {
        $scope.choices.transfer[key].map(item => item.selected = selected)
    }
})