import {services} from "./services.js"

angular.module("module", ["ngSanitize"]).controller("controller", function ($scope) {
    // set list of available services
    $scope.services = services

    // handle choices
    $scope.choices = {
        source: $scope.services[localStorage.getItem("source")],
        target: $scope.services[localStorage.getItem("target")],
        transfer: undefined
    }

    // handle current step and errors
    $scope.step = $scope.choices.source.token() ? ($scope.choices.target.token() ? 2 : 1) : 0
    $scope.error = false
    $scope.warning = (message, data) => {
        // in case of warning, set the error flag to true, remove the waiting response flag, clear the search, and log)
        $scope.error = true
        localStorage.removeItem("waiting")
        console.warn(message, data)
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
                    .done(_ => {
                        // store the role name, remove the waiting response flag, and clear the search
                        localStorage.setItem(role, name)
                        localStorage.removeItem("waiting")
                        location.search = ""
                    })
                    .fail(res => $scope.warning("Error after token exchange request", res))
            } else {
                $scope.warning("Wrong state yielded by the server", {
                    expected: service.state(),
                    obtained: params.get("state")
                })
            }
        } else {
            console.warn("Code received, but no service is waiting for it")
        }
    }

    // if in the transfer step
    if ($scope.step === 2) {
        const source = $scope.choices.source
        source.export()
    }

    // authorization handler for options
    $scope.authorize = role => {
        // retrieve the current service
        const service = $scope.choices[role]
        // if a token is already available, remove the waiting response flag, recompute the step, and set the role
        // otherwise store the waiting response flag and redirect to the authorization url
        if (service.token()) {
            localStorage.removeItem("waiting")
            localStorage.setItem(role, service.name)
            $scope.step = $scope.choices.source.token() ? ($scope.choices.target.token() ? 2 : 1) : 0
        } else {
            localStorage.setItem("waiting", role + " " + service.name)
            service.authorization_url().then(url => location.href = url)
        }
    }
})