package lab.controlagent;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.lang.instrument.Instrumentation;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;

/** Persistent loopback-only command endpoint backed by official client actions. */
public final class BridgeControlAgent {
  private static volatile boolean started;

  private BridgeControlAgent() {}

  public static synchronized void agentmain(String options, Instrumentation instrumentation) {
    if (started) return;
    String[] values = (options == null ? "" : options).split(",", -1);
    if (values.length != 3) throw new IllegalArgumentException("Expected LOG_PATH,PORT,TAG");
    Path log = Path.of(values[0]).toAbsolutePath();
    int port = Integer.parseInt(values[1]);
    String tag = values[2];
    started = true;
    Thread worker = new Thread(() -> serve(log, port, tag, instrumentation), "bridge-control-agent");
    worker.setDaemon(true);
    worker.start();
  }

  private static void serve(Path log, int port, String tag, Instrumentation instrumentation) {
    try {
      Actions actions = new Actions(instrumentation);
      try (ServerSocket server = new ServerSocket(port, 8, InetAddress.getLoopbackAddress())) {
        write(log, "listening tag=" + tag + " port=" + port);
        while (!server.isClosed()) {
          try (Socket socket = server.accept();
               BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
               PrintWriter writer = new PrintWriter(socket.getOutputStream(), true, StandardCharsets.UTF_8)) {
            String line;
            while ((line = reader.readLine()) != null) {
              try {
                String response = execute(actions, line);
                writer.println("OK " + response);
                write(log, "command=" + line + " response=" + response);
              } catch (Throwable error) {
                Throwable root = root(error);
                writer.println("ERR " + root);
                write(log, "command_error=" + line + " error=" + root);
              }
            }
          } catch (IOException error) {
            write(log, "client_error=" + error);
          }
        }
      }
    } catch (Throwable error) {
      started = false;
      write(log, "server_error=" + root(error));
    }
  }

  private static String execute(Actions actions, String line) throws Exception {
    String[] parts = line.trim().split("\\s+");
    if (parts.length == 0) throw new IllegalArgumentException("Empty command");
    return switch (parts[0].toUpperCase()) {
      case "PING" -> "PONG";
      case "STATE" -> actions.inBattle() ? "BATTLE" : "OVERWORLD";
      case "MOVE" -> {
        if (parts.length != 2) throw new IllegalArgumentException("MOVE requires direction 0..3");
        byte direction = Byte.parseByte(parts[1]);
        if (direction < 0 || direction > 3) throw new IllegalArgumentException("Direction must be 0..3");
        if (actions.inBattle()) yield "SKIPPED_BATTLE";
        actions.move(direction);
        yield "MOVED " + direction;
      }
      case "BATTLE" -> {
        if (parts.length != 2) throw new IllegalArgumentException("BATTLE requires move id");
        int moveId = Integer.parseInt(parts[1]);
        if (moveId < 1 || moveId > 65535) throw new IllegalArgumentException("Move id must be 1..65535");
        if (!actions.inBattle()) yield "SKIPPED_OVERWORLD";
        actions.battleMove((short) moveId);
        yield "BATTLE_MOVE " + moveId;
      }
      default -> throw new IllegalArgumentException("Unknown command: " + parts[0]);
    };
  }

  private static final class Actions {
    private final Field activeSession;
    private final Field battle;
    private final Field connection;
    private final Method move;
    private final Method queue;
    private final Constructor<?> battlePacket;

    Actions(Instrumentation instrumentation) throws Exception {
      Class<?> globals = findLoaded(instrumentation, "f.Ot");
      Class<?> sessionType = findLoaded(instrumentation, "f.ln1");
      Class<?> connectionType = findLoaded(instrumentation, "f.hU");
      Class<?> packetType = findLoaded(instrumentation, "f.z30");
      Class<?> packetBaseType = findLoaded(instrumentation, "f.Uu1");
      Class<?> actorType = findLoaded(instrumentation, "f.fd1");
      activeSession = globals.getField("Z02");
      battle = globals.getField("Bu");
      connection = sessionType.getField("bf");
      move = sessionType.getMethod("bI", byte.class, boolean.class, boolean.class);
      queue = connectionType.getMethod("wx1", packetBaseType);
      battlePacket = packetType.getConstructor(actorType, short.class, byte.class);
    }

    boolean inBattle() throws IllegalAccessException {
      return battle.get(null) != null;
    }

    Object session() throws IllegalAccessException {
      Object value = activeSession.get(null);
      if (value == null) throw new IllegalStateException("No active game session");
      return value;
    }

    void move(byte direction) throws Exception {
      move.invoke(session(), direction, false, false);
    }

    void battleMove(short moveId) throws Exception {
      Object current = session();
      Object packet = battlePacket.newInstance(null, moveId, (byte) 0);
      queue.invoke(connection.get(current), packet);
    }
  }

  private static Class<?> findLoaded(Instrumentation instrumentation, String name) {
    for (Class<?> candidate : instrumentation.getAllLoadedClasses()) {
      if (candidate.getName().equals(name)) return candidate;
    }
    throw new IllegalStateException("Required class is not loaded: " + name);
  }

  private static Throwable root(Throwable error) {
    Throwable current = error;
    while (current.getCause() != null) current = current.getCause();
    return current;
  }

  private static synchronized void write(Path path, String message) {
    try {
      Path parent = path.getParent();
      if (parent != null) Files.createDirectories(parent);
      Files.writeString(path, Instant.now() + " " + message + System.lineSeparator(),
        StandardOpenOption.CREATE, StandardOpenOption.APPEND);
    } catch (IOException ignored) {}
  }
}
