package lab.battleagent;

import java.io.IOException;
import java.lang.instrument.Instrumentation;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;

/** Queues the official f.z30 MOVE packet through the authenticated client transport. */
public final class BattleMoveAgent {
  private BattleMoveAgent() {}

  public static void agentmain(String options, Instrumentation instrumentation) {
    String[] values = (options == null ? "" : options).split(",", -1);
    if (values.length != 3) throw new IllegalArgumentException("Expected LOG_PATH,MOVE_ID,TAG");
    Path logPath = Path.of(values[0]).toAbsolutePath();
    short moveId = Short.parseShort(values[1]);
    String tag = values[2];
    Thread worker = new Thread(() -> send(logPath, moveId, tag, instrumentation), "codex-battle-move-agent");
    worker.setDaemon(true);
    worker.start();
  }

  private static void send(Path logPath, short moveId, String tag, Instrumentation instrumentation) {
    try {
      Class<?> globalsClass = findLoaded(instrumentation, "f.Ot");
      Class<?> sessionClass = findLoaded(instrumentation, "f.ln1");
      Class<?> packetClass = findLoaded(instrumentation, "f.z30");
      Class<?> packetBaseClass = findLoaded(instrumentation, "f.Uu1");
      Class<?> connectionClass = findLoaded(instrumentation, "f.hU");
      Class<?> actorClass = findLoaded(instrumentation, "f.fd1");

      Field activeSession = globalsClass.getField("Z02");
      Field connection = sessionClass.getField("bf");
      // MOVE is action byte 0 (sV.q1) and includes a one-byte target. The
      // (fd1, sV, short) overload uses action byte 1 and appends an eight-byte
      // item identifier, which the server correctly rejects for a move.
      Constructor<?> packetConstructor = packetClass.getConstructor(actorClass, short.class, byte.class);
      Method queue = connectionClass.getMethod("wx1", packetBaseClass);
      Object session = activeSession.get(null);
      if (session == null) throw new IllegalStateException("No active game session");
      Object packet = packetConstructor.newInstance(null, moveId, (byte) 0);
      queue.invoke(connection.get(session), packet);
      write(logPath, "sent tag=" + tag + " moveId=" + moveId);
    } catch (Throwable error) {
      write(logPath, "agent_error tag=" + tag + " " + root(error));
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
