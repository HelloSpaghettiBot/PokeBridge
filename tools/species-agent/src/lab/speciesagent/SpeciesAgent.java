package lab.speciesagent;

import java.io.*;
import java.lang.instrument.Instrumentation;
import java.lang.reflect.Method;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Instant;

/** Read-only species-name resolver backed by the official client's Pokédex. */
public final class SpeciesAgent {
  private static volatile boolean started;
  private SpeciesAgent() {}
  public static synchronized void agentmain(String options, Instrumentation instrumentation) {
    if (started) return;
    String[] values = (options == null ? "" : options).split(",", -1);
    if (values.length != 3) throw new IllegalArgumentException("Expected LOG_PATH,PORT,TAG");
    started = true;
    new Thread(() -> serve(Path.of(values[0]), Integer.parseInt(values[1]), values[2], instrumentation), "bridge-species-resolver").start();
  }
  private static void serve(Path log, int port, String tag, Instrumentation instrumentation) {
    try {
      Class<?> databaseType = loaded(instrumentation, "f.Fq1");
      Object database = databaseType.getMethod("NuL").invoke(null);
      Method lookup = databaseType.getMethod("Nl0", short.class);
      try (ServerSocket server = new ServerSocket(port, 8, InetAddress.getLoopbackAddress())) {
        write(log, "listening tag=" + tag + " port=" + port);
        while (!server.isClosed()) try (Socket socket = server.accept(); BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8)); PrintWriter writer = new PrintWriter(socket.getOutputStream(), true, StandardCharsets.UTF_8)) {
          String line;
          while ((line = reader.readLine()) != null) try {
            String trimmed = line.trim();
            if (trimmed.equalsIgnoreCase("PING")) writer.println("OK PONG SPECIES");
            else if (trimmed.regionMatches(true, 0, "RESOLVE ", 0, 8)) writer.println("OK " + resolve(database, lookup, trimmed.substring(8).trim()));
            else if (trimmed.regionMatches(true, 0, "INFO ", 0, 5)) writer.println("OK " + info(database, lookup, Short.parseShort(trimmed.substring(5).trim())));
            else throw new IllegalArgumentException("Unknown command: " + line);
          } catch (Throwable error) {
            while (error.getCause() != null) error = error.getCause();
            writer.println("ERR " + error);
          }
        }
      }
    } catch (Throwable error) { started = false; write(log, "server_error=" + error); }
  }
  private static String resolve(Object database, Method lookup, String query) throws Exception {
    try {
      int id = Integer.parseInt(query);
      Object definition = lookup.invoke(database, (short) id);
      if (definition != null) return describe(id, definition);
    } catch (NumberFormatException ignored) {}
    String wanted = normalize(query);
    for (int id = 1; id <= 2000; id++) {
      Object definition = lookup.invoke(database, (short) id);
      if (definition == null) continue;
      String name = String.valueOf(definition.getClass().getMethod("RE1").invoke(definition));
      if (normalize(name).equals(wanted)) return "SPECIES id=" + id + " name=" + name.replace(' ', '_');
    }
    return "NOT_FOUND query=" + query.replace(' ', '_');
  }
  private static String describe(int id, Object definition) throws Exception {
    String name = String.valueOf(definition.getClass().getMethod("RE1").invoke(definition));
    return "SPECIES id=" + id + " name=" + name.replace(' ', '_');
  }
  private static String info(Object database, Method lookup, short id) throws Exception {
    Object definition = lookup.invoke(database, id);
    if (definition == null) return "NOT_FOUND id=" + Short.toUnsignedInt(id);
    String name = String.valueOf(definition.getClass().getMethod("RE1").invoke(definition)).replace(' ', '_');
    Object primary = field(definition, "mx").get(definition);
    Object secondary = field(definition, "dz0").get(definition);
    String first = typeName(primary);
    String second = secondary == null || secondary == primary ? "" : typeName(secondary);
    return "SPECIES id=" + Short.toUnsignedInt(id) + " name=" + name + " types=" + first + (second.isEmpty() ? "" : "," + second);
  }
  private static String typeName(Object type) throws Exception {
    return type == null ? "" : String.valueOf(type.getClass().getMethod("lG1").invoke(type)).replace(' ', '_');
  }
  private static java.lang.reflect.Field field(Object value, String name) throws Exception {
    for (Class<?> cursor = value.getClass(); cursor != null; cursor = cursor.getSuperclass()) try {
      java.lang.reflect.Field result = cursor.getDeclaredField(name); result.trySetAccessible(); return result;
    } catch (NoSuchFieldException ignored) {}
    throw new NoSuchFieldException(name);
  }
  private static String normalize(String value) { return value.replaceAll("[^A-Za-z0-9]", "").toLowerCase(); }
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
