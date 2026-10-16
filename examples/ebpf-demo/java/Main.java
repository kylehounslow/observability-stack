// HTTP service with no OTel SDK. Logs the traceparent it receives, then calls each URL in CALLS.
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.Executors;

public class Main {
    public static void main(String[] args) throws Exception {
        HttpClient client = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(5)).build();
        String callsEnv = System.getenv().getOrDefault("CALLS", "");
        String[] calls = callsEnv.isEmpty() ? new String[0] : callsEnv.split(",");
        HttpServer server = HttpServer.create(new InetSocketAddress(Integer.parseInt(System.getenv("PORT"))), 0);
        server.setExecutor(Executors.newFixedThreadPool(8));
        server.createContext("/", ex -> {
            System.out.println("recv path=" + ex.getRequestURI().getPath() + " traceparent=" + ex.getRequestHeaders().getFirst("traceparent"));
            for (String u : calls) {
                try {
                    client.send(HttpRequest.newBuilder(URI.create(u)).timeout(Duration.ofSeconds(5)).GET().build(), HttpResponse.BodyHandlers.discarding());
                } catch (Exception e) {
                    System.err.println("call " + u + ": " + e);
                }
            }
            byte[] body = "ok".getBytes();
            ex.sendResponseHeaders(200, body.length);
            ex.getResponseBody().write(body);
            ex.close();
        });
        server.start();
    }
}
