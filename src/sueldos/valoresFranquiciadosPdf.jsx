// PDF de "Valores de referencia para franquiciados" (PantallaSueldosFranquiciados): una página A4 con el
// título, el período y la tabla Concepto · Valor · Cómo se paga. Texto real (no foto): se lee y se
// copia desde cualquier celular. Se importa recién al descargar para no sumar @react-pdf al bundle inicial.
import { Document, Page, View, Text, StyleSheet, pdf } from "@react-pdf/renderer";

const S = StyleSheet.create({
  page:   { fontFamily: "Helvetica", fontSize: 10, color: "#1e293b", padding: 48 },
  titulo: { fontFamily: "Helvetica-Bold", fontSize: 18, marginBottom: 4 },
  sub:    { fontSize: 10, color: "#64748b", marginBottom: 20 },
  head:   { flexDirection: "row", backgroundColor: "#f1f5f9", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  fila:   { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0" },
  th:     { fontFamily: "Helvetica-Bold", fontSize: 8, color: "#64748b", paddingVertical: 7, paddingHorizontal: 8 },
  td:     { paddingVertical: 7, paddingHorizontal: 8 },
  cConcepto: { width: "34%" },
  cValor:    { width: "20%", textAlign: "right" },
  cComo:     { width: "46%" },
  pie:    { fontSize: 8, color: "#94a3b8", marginTop: 16 },
});

// Arma el documento (función, no componente: se llama directo al generar el PDF).
function documentoValores({ titulo, subtitulo, filas, pie }) {
  return (
    <Document title={titulo}>
      <Page size="A4" style={S.page}>
        <Text style={S.titulo}>{titulo}</Text>
        <Text style={S.sub}>{subtitulo}</Text>
        <View style={S.head}>
          <Text style={[S.th, S.cConcepto]}>CONCEPTO</Text>
          <Text style={[S.th, S.cValor]}>VALOR</Text>
          <Text style={[S.th, S.cComo]}>CÓMO SE PAGA</Text>
        </View>
        {filas.map(f => (
          <View key={f.concepto} style={S.fila} wrap={false}>
            <Text style={[S.td, S.cConcepto, { fontFamily: "Helvetica-Bold" }]}>{f.concepto}</Text>
            <Text style={[S.td, S.cValor]}>{f.valor}</Text>
            <Text style={[S.td, S.cComo, { color: "#64748b" }]}>{f.como}</Text>
          </View>
        ))}
        {pie && <Text style={S.pie}>{pie}</Text>}
      </Page>
    </Document>
  );
}

// Genera el PDF y lo descarga con `nombre`.
export async function descargarValoresPdf({ nombre, ...doc }) {
  const blob = await pdf(documentoValores(doc)).toBlob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
