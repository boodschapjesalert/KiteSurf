package nl.kiteweer.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Calendar;

/**
 * Bootst het gedrag van een Apps Script /exec-URL na: POST -> 302 naar een "echo"-URL -> GET
 * geeft de JSON. (Live gecontroleerd met curl tegen de echte deployment, zie README "Android-app".)
 */
public class KiteweerHttpTest {
    private ServerSocket server;
    private Thread lus;
    private String basis;
    private volatile String ontvangenBody;
    private volatile String echoMethode;

    /** Minimale HTTP/1.1-server (android.jar heeft geen com.sun.net.httpserver). */
    @Before
    public void start() throws IOException {
        server = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        basis = "http://127.0.0.1:" + server.getLocalPort();
        lus = new Thread(() -> {
            while (!server.isClosed()) {
                try (Socket s = server.accept()) {
                    behandel(s);
                } catch (IOException e) {
                    // Server gestopt.
                }
            }
        });
        lus.start();
    }

    private void behandel(Socket s) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
        String[] verzoekRegel = in.readLine().split(" ");
        int lengte = 0;
        String regel;
        while ((regel = in.readLine()) != null && !regel.isEmpty()) {
            if (regel.toLowerCase().startsWith("content-length:")) lengte = Integer.parseInt(regel.substring(15).trim());
        }
        char[] body = new char[lengte];
        int gelezen = 0;
        while (gelezen < lengte) gelezen += in.read(body, gelezen, lengte - gelezen);

        String pad = verzoekRegel[1];
        OutputStream uit = s.getOutputStream();
        if (pad.startsWith("/exec")) {
            ontvangenBody = new String(body);
            schrijf(uit, "302 Found", "Location: /echo?sleutel=abc\r\n", "");
        } else if (pad.startsWith("/echo")) {
            echoMethode = verzoekRegel[0];
            schrijf(uit, "200 OK", "Content-Type: application/json\r\n", "{\"resultaten\":[{\"naam\":\"Rockanje\"}]}");
        } else {
            schrijf(uit, "500 Internal Server Error", "", "oeps");
        }
    }

    private static void schrijf(OutputStream uit, String status, String headers, String tekst) throws IOException {
        byte[] data = tekst.getBytes(StandardCharsets.UTF_8);
        uit.write(("HTTP/1.1 " + status + "\r\n" + headers + "Content-Length: " + data.length + "\r\nConnection: close\r\n\r\n")
                .getBytes(StandardCharsets.UTF_8));
        uit.write(data);
        uit.flush();
    }

    @After
    public void stop() throws Exception {
        server.close();
        lus.join(2000);
    }

    @Test
    public void postVolgtDeRedirectMetEenGet() throws Exception {
        JSONObject verzoek = new JSONObject().put("actie", "zoekLocatie").put("zoekterm", "Rockanje");
        JSONObject antwoord = KiteweerHttp.postJson(basis + "/exec", verzoek);
        assertEquals("Rockanje", antwoord.getJSONArray("resultaten").getJSONObject(0).getString("naam"));
        assertEquals("zoekLocatie", new JSONObject(ontvangenBody).getString("actie"));
        assertEquals("GET", echoMethode);
    }

    @Test
    public void foutcodeGeeftIOException() throws Exception {
        try {
            KiteweerHttp.postJson(basis + "/kapot", new JSONObject());
            fail("verwachtte IOException");
        } catch (IOException verwacht) {
            assertTrue(verwacht.getMessage().contains("500"));
        }
    }

    @Test
    public void nachtrustVan2230Tot0630() {
        Calendar c = Calendar.getInstance();
        c.set(Calendar.HOUR_OF_DAY, 22);
        c.set(Calendar.MINUTE, 29);
        assertFalse(KiteweerAchtergrond.isNacht(c));
        c.set(Calendar.MINUTE, 30);
        assertTrue(KiteweerAchtergrond.isNacht(c));
        c.set(Calendar.HOUR_OF_DAY, 6);
        c.set(Calendar.MINUTE, 29);
        assertTrue(KiteweerAchtergrond.isNacht(c));
        c.set(Calendar.MINUTE, 30);
        assertFalse(KiteweerAchtergrond.isNacht(c));
    }
}
