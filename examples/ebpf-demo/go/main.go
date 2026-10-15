// HTTP service with no OTel SDK. Logs the traceparent it receives, then calls each URL in CALLS.
package main

import (
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

func main() {
	client := &http.Client{Timeout: 5 * time.Second}
	var calls []string
	if c := os.Getenv("CALLS"); c != "" {
		calls = strings.Split(c, ",")
	}
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("recv path=%s traceparent=%q", r.URL.Path, r.Header.Get("traceparent"))
		for _, u := range calls {
			resp, err := client.Get(u)
			if err != nil {
				log.Printf("call %s: %v", u, err)
				continue
			}
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		}
		w.Write([]byte("ok"))
	})
	log.Fatal(http.ListenAndServe(":"+os.Getenv("PORT"), nil))
}
