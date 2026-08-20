package lab.battlecontrol;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.lang.instrument.Instrumentation;
import java.lang.reflect.Array;
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

/** Persistent battle move selector that does not depend on transient UI widgets. */
public final class BattleControlAgent {
  private static volatile boolean started;
  private BattleControlAgent() {}

  public static synchronized void agentmain(String options, Instrumentation instrumentation) {
    if (started) return;
    String[] values = (options == null ? "" : options).split(",", -1);
    if (values.length != 3) throw new IllegalArgumentException("Expected LOG_PATH,PORT,TAG");
    started = true;
    new Thread(() -> serve(Path.of(values[0]), Integer.parseInt(values[1]), values[2], instrumentation), "bridge-battle-control").start();
  }

  private static void serve(Path log, int port, String tag, Instrumentation instrumentation) {
    try {
      Actions actions = new Actions(instrumentation);
      try (ServerSocket server = new ServerSocket(port, 8, InetAddress.getLoopbackAddress())) {
        write(log, "listening tag=" + tag + " port=" + port);
        while (!server.isClosed()) try (Socket socket = server.accept();
          BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
          PrintWriter writer = new PrintWriter(socket.getOutputStream(), true, StandardCharsets.UTF_8)) {
          String line;
          while ((line = reader.readLine()) != null) try {
            String response = switch (line.trim().toUpperCase()) {
              case "PING" -> "PONG BATTLE";
              case "AUTO" -> actions.autoMove();
              default -> throw new IllegalArgumentException("Unknown command: " + line);
            };
            writer.println("OK " + response);
          } catch (Throwable error) {
            while (error.getCause() != null) error = error.getCause();
            writer.println("ERR " + error);
            write(log, "command_error=" + line + " error=" + error);
          }
        }
      }
    } catch (Throwable error) { started = false; write(log, "server_error=" + error); }
  }

  private static final class Actions {
    final Field battleField;
    final Object session;
    final Field connection;
    final Method queue;
    final Constructor<?> movePacket;
    final Object moveDatabase;
    final Method moveLookup;

    Actions(Instrumentation instrumentation) throws Exception {
      Class<?> globals = loaded(instrumentation, "f.Ot");
      battleField = globals.getField("Bu");
      session = globals.getField("Z02").get(null);
      Class<?> sessionType = loaded(instrumentation, "f.ln1");
      connection = sessionType.getField("bf");
      Class<?> packetBase = loaded(instrumentation, "f.Uu1");
      queue = loaded(instrumentation, "f.hU").getMethod("wx1", packetBase);
      Class<?> packetType = loaded(instrumentation, "f.z30");
      movePacket = findConstructor(packetType, parameters -> parameters.length == 3 && parameters[1] == short.class && parameters[2] == byte.class);
      Class<?> databaseType = loaded(instrumentation, "f.mj");
      moveDatabase = databaseType.getMethod("aF1").invoke(null);
      moveLookup = databaseType.getMethod("le0", short.class);
    }

    String autoMove() throws Exception {
      Object battle = battleField.get(null);
      if (battle == null) return "SKIPPED_OVERWORLD";
      Object matrix = battle.getClass().getField("dO").get(battle);
      Object ownRow = Array.get(matrix, 0);
      Object pokemon = null;
      for (int index = 0; index < Array.getLength(ownRow); index++) {
        Object candidate = Array.get(ownRow, index);
        if (candidate != null && ((Number) candidate.getClass().getMethod("Kh").invoke(candidate)).intValue() > 0) { pokemon = candidate; break; }
      }
      if (pokemon == null) return "NO_ACTIVE_POKEMON";
      short[] ids = (short[]) pokemon.getClass().getMethod("Fj1").invoke(pokemon);
      byte[] pp = (byte[]) pokemon.getClass().getMethod("HB1").invoke(pokemon);
      int best = -1, bestPower = -1;
      String bestName = "";
      for (int index = 0; index < Math.min(ids.length, pp.length); index++) {
        if (ids[index] <= 0 || pp[index] <= 0) continue;
        Object definition = moveLookup.invoke(moveDatabase, ids[index]);
        if (definition == null) continue;
        int power = shortField(definition, "XZ");
        if (power > bestPower) {
          best = index;
          bestPower = power;
          try { bestName = String.valueOf(definition.getClass().getMethod("lw1").invoke(definition)); }
          catch (Throwable ignored) { bestName = "Move_" + ids[index]; }
        }
      }
      if (best < 0 || bestPower <= 0) return "NO_DAMAGE_PP";
      Object packet = movePacket.newInstance(null, ids[best], (byte) 0);
      queue.invoke(connection.get(session), packet);
      return "AUTO_MOVE moveId=" + ids[best] + " name=" + bestName.replace(' ', '_') + " pp=" + pp[best] + " power=" + bestPower;
    }
  }

  private static short shortField(Object value, String name) throws Exception {
    for (Class<?> cursor = value.getClass(); cursor != null; cursor = cursor.getSuperclass()) try {
      Field field = cursor.getDeclaredField(name); field.trySetAccessible(); return field.getShort(value);
    } catch (NoSuchFieldException ignored) {}
    throw new NoSuchFieldException(name);
  }
  private static Constructor<?> findConstructor(Class<?> type, java.util.function.Predicate<Class<?>[]> match) throws NoSuchMethodException {
    for (Constructor<?> constructor : type.getConstructors()) if (match.test(constructor.getParameterTypes())) return constructor;
    throw new NoSuchMethodException(type.getName() + " compatible constructor");
  }
  private static Class<?> loaded(Instrumentation instrumentation, String name) {
    ClassLoader loader = null;
    for (Class<?> type : instrumentation.getAllLoadedClasses()) {
      if (type.getName().equals(name)) return type;
      if (type.getName().equals("f.Ot")) loader = type.getClassLoader();
    }
    try { return Class.forName(name, false, loader); }
    catch (ClassNotFoundException error) { throw new IllegalStateException("Class unavailable: " + name, error); }
  }
  private static synchronized void write(Path path, String message) {
    try { Files.writeString(path, Instant.now() + " " + message + System.lineSeparator(), StandardOpenOption.CREATE, StandardOpenOption.APPEND); }
    catch (Exception ignored) {}
  }
}
