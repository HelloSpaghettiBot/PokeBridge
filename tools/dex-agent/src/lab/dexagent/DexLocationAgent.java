package lab.dexagent;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.lang.instrument.Instrumentation;
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
import java.util.Base64;
import java.util.List;

/** Read-only endpoint for the official client's Wild Locations cache. */
public final class DexLocationAgent {
  private static volatile boolean started;
  private DexLocationAgent() {}

  public static synchronized void agentmain(String options, Instrumentation instrumentation) {
    if (started) return;
    String[] values = (options == null ? "" : options).split(",", -1);
    if (values.length != 3) throw new IllegalArgumentException("Expected LOG_PATH,PORT,TAG");
    started = true;
    new Thread(() -> serve(Path.of(values[0]), Integer.parseInt(values[1]), values[2], instrumentation), "bridge-dex-locations").start();
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
                String[] parts = line.trim().split("\\s+");
                String response = switch (parts[0].toUpperCase()) {
                  case "PING" -> "PONG DEX";
                  case "LOOKUP" -> {
                    if (parts.length != 2) throw new IllegalArgumentException("LOOKUP speciesId");
                    yield actions.lookup(Short.parseShort(parts[1]));
                  }
                  default -> throw new IllegalArgumentException("Unknown command: " + parts[0]);
                };
                writer.println("OK " + response);
              } catch (Throwable error) {
                while (error.getCause() != null) error = error.getCause();
                writer.println("ERR " + error);
                write(log, "command_error=" + line + " error=" + error);
              }
            }
          }
        }
      }
    } catch (Throwable error) {
      started = false;
      write(log, "server_error=" + error);
    }
  }

  private static final class Actions {
    final Class<?> locationsType;
    final Object locationIndex;
    final Method indexLookup;
    final Method regionName;
    final Method localized;
    final Method localizedOr;

    Actions(Instrumentation instrumentation) throws Exception {
      Class<?> indexType = loaded(instrumentation, "f.X21");
      Object index = indexType.getField("ap1").get(null);
      locationIndex = indexType.getField("vf").get(index);
      indexLookup = locationIndex.getClass().getMethod("gi0", short.class);
      locationsType = loaded(instrumentation, "f.Fa1");
      regionName = loaded(instrumentation, "f.xq1").getMethod("su0", byte.class);
      Class<?> strings = loaded(instrumentation, "f.nV0");
      localized = strings.getMethod("Id1", int.class);
      localizedOr = strings.getMethod("jh", int.class, String.class);
    }

    String lookup(short speciesId) throws Exception {
      Object cached = indexLookup.invoke(locationIndex, speciesId);
      if (cached == null) return encode("{\"speciesId\":" + speciesId + ",\"source\":\"client-cache\",\"cached\":false,\"locations\":[]}");
      @SuppressWarnings("unchecked")
      List<Object> locations = (List<Object>) locationsType.getMethod("oy0").invoke(cached);
      StringBuilder json = new StringBuilder("{\"speciesId\":").append(speciesId)
        .append(",\"source\":\"client-wild-locations\",\"cached\":true,\"locations\":[");
      boolean first = true;
      for (Object location : locations) {
        if (!first) json.append(',');
        first = false;
        byte region = byteField(location, "Ph");
        byte locationId = byteField(location, "rK1");
        Object type = field(location, "n81").get(location);
        int typeStringId = intField(type, "fP");
        int methodCode = intField(type, "AJ0");
        byte subtype = byteField(location, "q81");
        short rarityFlags = shortField(location, "Zt1");
        byte timeFlags = byteField(location, "gz0");
        byte season = byteField(location, "p8");
        int minimum = Byte.toUnsignedInt(byteField(location, "H61"));
        int maximum = Byte.toUnsignedInt(byteField(location, "oz0"));
        String regionText = String.valueOf(regionName.invoke(null, region));
        String locationText = String.valueOf(localizedOr.invoke(null, 140000 + 1000 * region + Byte.toUnsignedInt(locationId), "???"));
        String typeText = String.valueOf(localized.invoke(null, typeStringId));
        String rarity = rarity(rarityFlags);
        json.append("{\"regionId\":").append(region)
          .append(",\"region\":\"").append(escape(regionText)).append("\"")
          .append(",\"locationId\":").append(Byte.toUnsignedInt(locationId))
          .append(",\"location\":\"").append(escape(locationText)).append("\"")
          .append(",\"type\":\"").append(escape(typeText)).append("\"")
          .append(",\"methodCode\":").append(methodCode)
          .append(",\"subtype\":").append(subtype)
          .append(",\"levelMin\":").append(minimum)
          .append(",\"levelMax\":").append(maximum)
          .append(",\"rarity\":\"").append(rarity).append("\"")
          .append(",\"rarityFlags\":").append(Short.toUnsignedInt(rarityFlags))
          .append(",\"timeFlags\":").append(Byte.toUnsignedInt(timeFlags))
          .append(",\"times\":").append(times(timeFlags))
          .append(",\"season\":").append(season)
          .append('}');
      }
      json.append("]}");
      return encode(json.toString());
    }
  }

  private static String rarity(short flags) {
    if ((flags & 1) != 0) return "Very Common";
    if ((flags & 2) != 0) return "Common";
    if ((flags & 4) != 0) return "Uncommon";
    if ((flags & 8) != 0) return "Rare";
    if ((flags & 16) != 0) return "Very Rare";
    if ((flags & 64) != 0) return "Special";
    if ((flags & 128) != 0) return "Lure";
    if ((flags & 256) != 0) return "Swarm";
    return "Unknown";
  }

  private static String times(byte flags) {
    StringBuilder value = new StringBuilder("[");
    if ((flags & 1) != 0) value.append("\"Morning\",");
    if ((flags & 2) != 0) value.append("\"Day\",");
    if ((flags & 4) != 0) value.append("\"Night\",");
    if (value.charAt(value.length() - 1) == ',') value.setLength(value.length() - 1);
    return value.append(']').toString();
  }

  private static String encode(String json) {
    return "DEX_B64 " + Base64.getEncoder().encodeToString(json.getBytes(StandardCharsets.UTF_8));
  }

  private static String escape(String value) {
    return value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\r", "\\r").replace("\n", "\\n");
  }

  private static Field field(Object value, String name) throws Exception {
    for (Class<?> cursor = value.getClass(); cursor != null; cursor = cursor.getSuperclass()) {
      try { Field result = cursor.getDeclaredField(name); result.trySetAccessible(); return result; }
      catch (NoSuchFieldException ignored) {}
    }
    throw new NoSuchFieldException(name);
  }
  private static byte byteField(Object value, String name) throws Exception { return field(value, name).getByte(value); }
  private static short shortField(Object value, String name) throws Exception { return field(value, name).getShort(value); }
  private static int intField(Object value, String name) throws Exception { return field(value, name).getInt(value); }
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
